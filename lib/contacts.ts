import { getFirestore } from "@/lib/firebase";
import { getStoredBotToken } from "@/lib/slack-installations";

/**
 * Fetch contacts from Slack workspace members
 */

export interface Contact {
  id: string;
  name: string;
  title: string;
  organization: string;
  summary?: string;
  skills?: string[];
  experience?: string;
  email: string;
  avatar?: string;
  lastUpdated?: number;
  enrichedAt?: number; // timestamp when enrichment was last attempted
  enrichmentAttempts?: number; // count of enrichment attempts (for rate limit tracking)
}

interface TavilyEnrichmentResult {
  skills: string[];
  summary: string;
  experience: string;
}

interface SlackUser {
  id: string;
  real_name: string;
  is_bot?: boolean;
  deleted?: boolean;
  is_app_user?: boolean;
  profile: {
    email?: string;
    title?: string;
    phone?: string;
    skype?: string;
    real_name: string;
    real_name_normalized: string;
    display_name: string;
    display_name_normalized: string;
    status_text?: string;
    status_emoji?: string;
    status_expiration?: number;
    avatar_hash: string;
    image_24?: string;
    image_32?: string;
    image_48?: string;
    image_72?: string;
    image_192?: string;
    image_512?: string;
    team: string;
  };
}

interface SlackUsersListResponse {
  ok: boolean;
  members: SlackUser[];
  error?: string;
  response_metadata?: {
    next_cursor?: string;
  };
}

const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes
const CONTACTS_COLLECTION = "contacts";
const ENRICHMENT_CACHE_DURATION = 7 * 24 * 60 * 60 * 1000; // 7 days
const MAX_ENRICHMENT_RETRIES = 3;
const TAVILY_BATCH_DELAY = 500; // 500ms between requests to avoid rate limits

const contactsCacheByWorkspace: Map<string, Contact[]> = new Map();
const cacheTimestampByWorkspace: Map<string, number> = new Map();

function getBotTokenFromEnv(workspaceId: string): string | null {
  const tokenMapRaw = process.env.SLACK_BOT_TOKEN_MAP;
  if (tokenMapRaw) {
    try {
      const tokenMap = JSON.parse(tokenMapRaw) as Record<string, string>;
      if (tokenMap[workspaceId]) {
        return tokenMap[workspaceId];
      }
    } catch (error) {
      console.error("[Contacts] Invalid SLACK_BOT_TOKEN_MAP JSON:", error);
    }
  }

  return process.env.SLACK_BOT_TOKEN || null;
}

async function getBotToken(workspaceId: string): Promise<string | null> {
  const storedToken = await getStoredBotToken(workspaceId);
  if (storedToken) {
    return storedToken;
  }

  return getBotTokenFromEnv(workspaceId);
}

function isSystemContact(contact: Pick<Contact, "id" | "name">): boolean {
  const id = contact.id.toUpperCase();
  const name = contact.name.toLowerCase();
  return id === "USLACKBOT" || name.includes("slackbot");
}

/**
 * Enrich a single contact using Tavily API
 * Returns enriched data or null if enrichment fails
 */
async function enrichContactWithTavily(contact: Contact): Promise<TavilyEnrichmentResult | null> {
  const tavilyKey = process.env.TAVILY_API_KEY;
  if (!tavilyKey) {
    console.warn("TAVILY_API_KEY not set, skipping enrichment");
    return null;
  }

  try {
    const payload = {
      api_key: tavilyKey,
      query: `${contact.name} ${contact.title} professional profile`,
      include_domains: ["linkedin.com", "github.com", "twitter.com"],
      max_results: 5,
    };

    const response = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      console.warn(
        `Tavily API error for ${contact.name}: ${response.status} ${response.statusText}`
      );
      return null;
    }

    const data = (await response.json()) as {
      results?: Array<{
        title?: string;
        content?: string;
        source?: string;
      }>;
    };

    if (!data.results || data.results.length === 0) {
      console.log(`[Tavily] No results found for ${contact.name}`);
      return null;
    }

    // Extract skills and experience from search results
    const combinedText = data.results
      .map((r) => `${r.title || ""} ${r.content || ""}`)
      .join(" ");

    // Parse skills (look for common tech keywords and job titles context)
    const skillKeywords = [
      "python",
      "javascript",
      "typescript",
      "nodejs",
      "react",
      "vue",
      "angular",
      "aws",
      "gcp",
      "azure",
      "docker",
      "kubernetes",
      "sql",
      "mongo",
      "firebase",
      "machine learning",
      "ai",
      "nlp",
      "data science",
      "backend",
      "frontend",
      "fullstack",
      "devops",
      "security",
      "infrastructure",
      "distributed systems",
    ];

    const textLower = combinedText.toLowerCase();
    const skills = skillKeywords.filter((skill) => textLower.includes(skill));

    // Extract summary (use first 300 chars from first result that looks like a profile)
    const summary = data.results
      .filter((r) => r.content && r.content.length > 50)
      .map((r) => r.content || "")
      .join(" ")
      .substring(0, 300)
      .trim();

    // Extract experience info (mentions of companies, roles)
    const experience = data.results
      .filter((r) => r.title)
      .slice(0, 3)
      .map((r) => r.title || "")
      .join("; ");

    return {
      skills: [...new Set(skills)], // deduplicate
      summary: summary || `Professional profile for ${contact.name}`,
      experience: experience || `${contact.title}`,
    };
  } catch (error) {
    console.error(`[Tavily] Enrichment failed for ${contact.name}:`, error);
    return null;
  }
}

/**
 * Check if contact needs re-enrichment
 */
function shouldEnrichContact(contact: Contact): boolean {
  // If successfully enriched recently, don't re-enrich
  if (contact.enrichedAt) {
    const timeSinceEnrichment = Date.now() - contact.enrichedAt;
    if (timeSinceEnrichment < ENRICHMENT_CACHE_DURATION) {
      return false; // Already successfully enriched
    }
  }

  // If we've hit max retries on a contact that never got enriched,
  // give up for now (skip enrichment). This prevents hammering Tavily
  // for contacts that consistently fail (wrong name, no results, etc.)
  if (
    !contact.enrichedAt &&
    contact.enrichmentAttempts &&
    contact.enrichmentAttempts >= MAX_ENRICHMENT_RETRIES
  ) {
    return false; // Give up on this contact for now
  }

  // Otherwise, try to enrich (either first time, or cache expired)
  return true;
}

/**
 * Enrich multiple contacts with Tavily, respecting rate limits
 */
async function enrichContactsBatch(
  contacts: Contact[]
): Promise<Contact[]> {
  const toEnrich = contacts.filter(shouldEnrichContact);

  if (toEnrich.length === 0) {
    console.log("[Enrichment] All contacts already enriched or rate-limited");
    return contacts;
  }

  console.log(
    `[Enrichment] Enriching ${toEnrich.length}/${contacts.length} contacts with Tavily...`
  );

  const enrichedContacts = await Promise.all(
    toEnrich.map(async (contact) => {
      const enrichmentResult = await enrichContactWithTavily(contact);

      if (enrichmentResult) {
        return {
          ...contact,
          skills: enrichmentResult.skills.length > 0 ? enrichmentResult.skills : contact.skills,
          summary: enrichmentResult.summary || contact.summary,
          experience: enrichmentResult.experience || contact.experience,
          enrichedAt: Date.now(), // ✅ Only mark as enriched on SUCCESS
          enrichmentAttempts: 1,
        };
      } else {
        // ⚠️ DON'T set enrichedAt on failure - let it retry next time
        // But track attempts for eventual rate limiting
        return {
          ...contact,
          enrichmentAttempts: (contact.enrichmentAttempts || 0) + 1,
          // Do NOT set enrichedAt - this allows shouldEnrichContact() to retry
        };
      }
    })
  );

  // Interleave delays to respect rate limits during batch processing
  const result = [...contacts];
  let enrichmentIndex = 0;
  for (const enriched of enrichedContacts) {
    const originalIndex = result.findIndex((c) => c.id === enriched.id);
    if (originalIndex !== -1) {
      result[originalIndex] = enriched;
      enrichmentIndex++;
      if (enrichmentIndex < enrichedContacts.length) {
        await new Promise((resolve) => setTimeout(resolve, TAVILY_BATCH_DELAY));
      }
    }
  }

  return result;
}

async function loadContactsFromFirestore(workspaceId: string): Promise<Contact[] | null> {
  try {
    const db = getFirestore();
    const snapshot = await db
      .collection(CONTACTS_COLLECTION)
      .doc(workspaceId)
      .collection("members")
      .get();
    if (snapshot.empty) return null;

    const contacts = snapshot.docs
      .filter((d) => d.id !== "_meta")
      .map((d) => d.data() as Contact)
      .filter((contact) => !isSystemContact(contact))
      .filter((contact) => {
        if (!contact.lastUpdated) return false;
        return Date.now() - contact.lastUpdated < CACHE_DURATION;
      });

    if (contacts.length === 0) return null;

    const wsCache = contactsCacheByWorkspace;
    wsCache.set(workspaceId, contacts);
    cacheTimestampByWorkspace.set(workspaceId, Math.max(...contacts.map((c) => c.lastUpdated ?? 0)));
    return contacts;
  } catch (error) {
    console.error(
      `Failed to load contacts from Firestore for workspace ${workspaceId}:`,
      error
    );
    return null;
  }
}

/**
 * Load only enrichment metadata from Firestore (enrichedAt, skills, summary, etc.)
 * without filtering by freshness, so we can reuse enrichment data across cache cycles
 */
async function loadEnrichmentMetadataFromFirestore(
  workspaceId: string
): Promise<Map<string, Partial<Contact>>> {
  try {
    const db = getFirestore();
    const snapshot = await db
      .collection(CONTACTS_COLLECTION)
      .doc(workspaceId)
      .collection("members")
      .get();
    if (snapshot.empty) return new Map();

    const enrichmentMap = new Map<string, Partial<Contact>>();

    snapshot.docs
      .filter((d) => d.id !== "_meta")
      .forEach((doc) => {
        const data = doc.data() as Contact;
        enrichmentMap.set(data.id, {
          skills: data.skills,
          summary: data.summary,
          experience: data.experience,
          enrichedAt: data.enrichedAt,
          enrichmentAttempts: data.enrichmentAttempts,
        });
      });

    return enrichmentMap;
  } catch (error) {
    console.error(
      `Failed to load enrichment metadata from Firestore for workspace ${workspaceId}:`,
      error
    );
    return new Map();
  }
}

async function saveContactsToFirestore(workspaceId: string, contacts: Contact[]): Promise<void> {
  try {
    const db = getFirestore();
    const now = Date.now();

    // Use batch writes to optimize: group up to 500 writes in a single batch
    const batch = db.batch();
    const workspaceCollection = db
      .collection(CONTACTS_COLLECTION)
      .doc(workspaceId)
      .collection("members");

    contacts.forEach((contact) => {
      batch.set(workspaceCollection.doc(contact.id), {
        ...contact,
        lastUpdated: now,
      });
    });

    // Save metadata
    batch.set(db.collection(CONTACTS_COLLECTION).doc(workspaceId), {
      lastUpdated: now,
      count: contacts.length,
    });

    await batch.commit();
  } catch (error) {
    console.error(
      `Failed to save contacts to Firestore for workspace ${workspaceId}:`,
      error
    );
  }
}

export async function getAllContacts(workspaceId: string): Promise<Contact[]> {
  // Return cached contacts if still fresh for this workspace
  const wsCache = contactsCacheByWorkspace.get(workspaceId);
  const wsTimestamp = cacheTimestampByWorkspace.get(workspaceId);
  if (wsCache && wsTimestamp && Date.now() - wsTimestamp < CACHE_DURATION) {
    return wsCache;
  }

  // Try Firestore cache first
  const firestoreContacts = await loadContactsFromFirestore(workspaceId);
  if (firestoreContacts) {
    return firestoreContacts;
  }
  console.log(`[Contacts] No valid cache found for workspace ${workspaceId}, fetching fresh from Slack...`);

  try {
    // this gets triggered when the cache is stale or doesn't exist, so we fetch fresh data from Slack
    const slackUsers = await fetchSlackUsers(workspaceId);

    // Filter out bots and deleted users. Do not require email because many workspaces
    // do not expose email via users.list unless users:read.email scope is granted.
    const activeUsers = slackUsers.filter((user) => {
      const isBot = !!user.is_bot || user.id.startsWith("B");
      const isDeleted = !!user.deleted;
      return !isBot && !isDeleted;
    });

    const filteredOut = slackUsers.length - activeUsers.length;
    console.log(
      `[Contacts] Slack users total=${slackUsers.length}, active=${activeUsers.length}, filteredOut=${filteredOut}`
    );

    // Load existing enrichment metadata from Firestore before creating fresh contacts
    const enrichmentMetadata = await loadEnrichmentMetadataFromFirestore(workspaceId);

    let contacts: Contact[] = activeUsers
      .map((user) => {
        const baseContact = transformSlackUserToContact(user);
        const enrichedMeta = enrichmentMetadata.get(user.id);
        return {
          ...baseContact,
          ...enrichedMeta,
          lastUpdated: Date.now(),
        } as Contact;
      })
      .filter((contact) => !isSystemContact(contact));

    // Enrich contacts with Tavily (async, non-blocking for cache)
    console.log(`[Enrichment] Starting enrichment for ${contacts.length} contacts...`);
    contacts = await enrichContactsBatch(contacts);

    // Update workspace cache
    contactsCacheByWorkspace.set(workspaceId, contacts);
    cacheTimestampByWorkspace.set(workspaceId, Date.now());

    // Persist to Firestore cache
    await saveContactsToFirestore(workspaceId, contacts);

    return contacts;
  } catch (error) {
    console.error(`Failed to fetch Slack contacts for workspace ${workspaceId}:`, error);
    return [];
  }
}

export function getContactById(id: string, contacts: Contact[]): Contact | undefined {
  return contacts.find((c) => c.id === id);
}

export function filterContactsBySkills(
  skills: string[],
  contacts: Contact[],
  threshold = 1
): Contact[] {
  return contacts.filter((contact) => {
    if (!contact.skills) return false;
    const matchCount = skills.filter((skill) =>
      contact.skills?.some(
        (s) =>
          s.toLowerCase().includes(skill.toLowerCase()) ||
          skill.toLowerCase().includes(s.toLowerCase())
      )
    ).length;
    return matchCount >= threshold;
  });
}

export function filterContactsByDomain(domain: string, contacts: Contact[]): Contact[] {
  console.log(`Filtering contacts by domain: ${domain}`);

  const domainKeywords = {
    ml: ["ML", "AI", "Machine Learning", "LLM", "Neural", "Data Science"],
    backend: [
      "Backend",
      "API",
      "Database",
      "Server",
      "Infrastructure",
      "DevOps",
    ],
    frontend: [
      "Frontend",
      "React",
      "UI",
      "UX",
      "Performance",
    ],
    fullstack: ["Full Stack", "Full-Stack"],
    security: ["Security", "Auth", "Encryption"],
    product: ["Product", "PM"],
  };

  const keywords = domainKeywords[domain as keyof typeof domainKeywords] || [];

  return contacts.filter((contact) => {
    const text = `${contact.title} ${contact.skills?.join(" ") || ""}`.toLowerCase();
    return keywords.some((kw) => text.includes(kw.toLowerCase()));
  });
}

async function fetchSlackUsers(workspaceId: string): Promise<SlackUser[]> {
  console.log("Fetching Slack users...👥");
  const botToken = await getBotToken(workspaceId);
  if (!botToken) {
    throw new Error(`Slack bot token is not configured for workspace ${workspaceId}`);
  }

  const response = await fetch("https://slack.com/api/users.list", {
    method: "GET",
    headers: {
      Authorization: `Bearer ${botToken}`,
    },
  });

  const data = (await response.json()) as SlackUsersListResponse;

  console.log("[SlackAPI] Response OK:", data.ok);
  console.log("[SlackAPI] Members count:", data.members?.length ?? 0);
  console.log("[SlackAPI] Error:", data.error);
  // console.log("[SlackAPI] Full response:", JSON.stringify(data, null, 2));

  if (!data.ok) {
    throw new Error(`Slack API error: ${data.error}`);
  }

  return data.members;
}

function transformSlackUserToContact(user: SlackUser): Contact {
  const profile = user.profile;

  return {
    id: user.id,
    name: profile.real_name || profile.display_name || "Unknown",
    title: profile.title || "Slack User",
    organization: "Workspace", // Slack doesn't provide org in free tier
    summary: profile.status_text || undefined,
    email: profile.email || "",
    avatar: profile.image_192,
    // Skills are not available in base Slack profiles
    // Could be extracted from status_text or title if formatted correctly
    skills: extractSkillsFromProfile(profile),
    experience: undefined, // Not available in Slack profiles
  };
}

function extractSkillsFromProfile(
  profile: SlackUser["profile"]
): string[] | undefined {
  const skills: string[] = [];

  // Try to extract skills from title
  const titleKeywords = [
    "engineer",
    "developer",
    "designer",
    "manager",
    "analyst",
    "scientist",
    "architect",
    "lead",
    "senior",
    "junior",
  ];

  if (profile.title) {
    const titleLower = profile.title.toLowerCase();
    titleKeywords.forEach((kw) => {
      if (titleLower.includes(kw)) {
        skills.push(kw);
      }
    });
  }

  // Try to extract from status
  if (profile.status_text) {
    const statusLower = profile.status_text.toLowerCase();
    const techKeywords = [
      "python",
      "javascript",
      "typescript",
      "react",
      "golang",
      "rust",
      "java",
      "aws",
      "gcp",
      "kubernetes",
      "docker",
      "ml",
      "ai",
      "data",
      "backend",
      "frontend",
      "fullstack",
    ];
    techKeywords.forEach((kw) => {
      if (statusLower.includes(kw)) {
        skills.push(kw);
      }
    });
  }

  return skills.length > 0 ? skills : undefined;
}

/**
 * Validate a contact to ensure it matches the intended person
 * Checks for consistency between title, skills, and enriched data
 */
export function validateContact(contact: Contact, requiredSkills: string[]): {
  isValid: boolean;
  confidence: number;
  issues: string[];
} {
  const issues: string[] = [];
  let confidence = 1.0;

  // Check if title contains relevant keywords
  const titleLower = contact.title.toLowerCase();
  const hasRelevantTitle = requiredSkills.some((skill) =>
    titleLower.includes(skill.toLowerCase())
  );

  if (!hasRelevantTitle && requiredSkills.length > 0) {
    issues.push(`Title "${contact.title}" doesn't contain expected skills`);
    confidence -= 0.15;
  }

  // Check if skills align with required skills
  if (contact.skills && contact.skills.length > 0 && requiredSkills.length > 0) {
    const matchedSkills = requiredSkills.filter((req) =>
      contact.skills?.some(
        (s) =>
          s.toLowerCase().includes(req.toLowerCase()) ||
          req.toLowerCase().includes(s.toLowerCase())
      )
    );

    if (matchedSkills.length === 0) {
      issues.push(`No skills match: required ${requiredSkills.join(", ")}, found ${contact.skills.join(", ")}`);
      confidence -= 0.25;
    } else if (matchedSkills.length < requiredSkills.length * 0.5) {
      issues.push(`Weak skill match: only ${matchedSkills.length}/${requiredSkills.length} skills align`);
      confidence -= 0.1;
    }
  }

  // Check if summary/experience contains relevant keywords
  if (contact.summary || contact.experience) {
    const combinedText = `${contact.summary || ""} ${contact.experience || ""}`.toLowerCase();
    const hasRelevantContext = requiredSkills.some((skill) =>
      combinedText.includes(skill.toLowerCase())
    );

    if (!hasRelevantContext && requiredSkills.length > 0) {
      issues.push("Summary/experience doesn't mention required skills");
      confidence -= 0.1;
    }
  } else {
    // No enriched data adds some uncertainty
    confidence -= 0.05;
  }

  // Contact is valid if confidence >= 0.35 (weak but acceptable)
  const isValid = confidence >= 0.35;

  return {
    isValid,
    confidence: Math.max(0, confidence),
    issues,
  };
}
