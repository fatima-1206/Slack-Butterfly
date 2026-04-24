import { getFirestore } from "@/lib/firebase";

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

let contactsCache: Contact[] | null = null;
let cacheTimestamp = 0;
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes
const CONTACTS_COLLECTION = "contacts";

function isSystemContact(contact: Pick<Contact, "id" | "name">): boolean {
  const id = contact.id.toUpperCase();
  const name = contact.name.toLowerCase();
  return id === "USLACKBOT" || name.includes("slackbot");
}

async function loadContactsFromFirestore(): Promise<Contact[] | null> {
  try {
    const db = getFirestore();
    const snapshot = await db.collection(CONTACTS_COLLECTION).get();
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

    contactsCache = contacts;
    cacheTimestamp = Math.max(...contacts.map((c) => c.lastUpdated ?? 0));
    return contactsCache;
  } catch (error) {
    console.error("Failed to load contacts from Firestore:", error);
    return null;
  }
}

async function saveContactsToFirestore(contacts: Contact[]): Promise<void> {
  try {
    const db = getFirestore();
    const now = Date.now();

    await Promise.all(
      contacts.map((contact) =>
        db
          .collection(CONTACTS_COLLECTION)
          .doc(contact.id)
          .set({
            ...contact,
            lastUpdated: now,
          })
      )
    );

    await db
      .collection(CONTACTS_COLLECTION)
      .doc("_meta")
      .set({
        lastUpdated: now,
        count: contacts.length,
      });
  } catch (error) {
    console.error("Failed to save contacts to Firestore:", error);
  }
}

export async function getAllContacts(): Promise<Contact[]> {
  // Return cached contacts if still fresh
  if (contactsCache && Date.now() - cacheTimestamp < CACHE_DURATION) {
    return contactsCache;
  }

  // Try Firestore cache first
  const firestoreContacts = await loadContactsFromFirestore();
  if (firestoreContacts) {
    return firestoreContacts;
  }
  console.log("No valid cache found, fetching fresh contacts from Slack...");

  try {
    // this gets triggered when the cache is stale or doesn't exist, so we fetch fresh data from Slack
    const slackUsers = await fetchSlackUsers();

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


    contactsCache = activeUsers
      .map((user) => ({
      ...transformSlackUserToContact(user),
      lastUpdated: Date.now(),
      }))
      .filter((contact) => !isSystemContact(contact));
    cacheTimestamp = Date.now();

    // Persist to Firestore cache
    await saveContactsToFirestore(contactsCache);

    return contactsCache;
  } catch (error) {
    console.error("Failed to fetch Slack contacts:", error);
    return [];
  }
}

export function getContactById(id: string): Contact | undefined {
  if (!contactsCache) {
    return undefined;
  }
  return contactsCache.find((c) => c.id === id);
}

export function filterContactsBySkills(
  skills: string[],
  threshold = 1
): Contact[] {
  if (!contactsCache) {
    return [];
  }

  return contactsCache.filter((contact) => {
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

export function filterContactsByDomain(domain: string): Contact[] {
  console.log(`Filtering contacts by domain: ${domain}`);
  if (!contactsCache) {
    return [];
  }

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

  return contactsCache.filter((contact) => {
    const text = `${contact.title} ${contact.skills?.join(" ") || ""}`.toLowerCase();
    return keywords.some((kw) => text.includes(kw.toLowerCase()));
  });
}

async function fetchSlackUsers(): Promise<SlackUser[]> {
  console.log("Fetching Slack users...👥");
  const botToken = process.env.SLACK_BOT_TOKEN;
  if (!botToken) {
    throw new Error("SLACK_BOT_TOKEN is not configured");
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
  console.log("[SlackAPI] Full response:", JSON.stringify(data, null, 2));

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
