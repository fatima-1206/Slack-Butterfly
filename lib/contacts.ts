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
}

interface SlackUser {
  id: string;
  real_name: string;
  profile: {
    email: string;
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
  response_metadata?: {
    next_cursor?: string;
  };
}

interface SlackUserInfoResponse {
  ok: boolean;
  user: SlackUser;
}

let contactsCache: Contact[] | null = null;
let cacheTimestamp: number = 0;
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

async function fetchSlackUsers(): Promise<SlackUser[]> {
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

  if (!data.ok) {
    throw new Error(`Slack API error: ${data}`);
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

export async function getAllContacts(): Promise<Contact[]> {
  // Return cached contacts if still fresh
  if (contactsCache && Date.now() - cacheTimestamp < CACHE_DURATION) {
    return contactsCache;
  }

  try {
    const slackUsers = await fetchSlackUsers();

    // Filter out bots and inactive users
    const activeUsers = slackUsers.filter((user) => {
      const isBot = user.profile.display_name === "bot" || user.id.startsWith("B");
      const hasEmail = !!user.profile.email;
      return !isBot && hasEmail;
    });

    contactsCache = activeUsers.map(transformSlackUserToContact);
    cacheTimestamp = Date.now();

    return contactsCache;
  } catch (error) {
    console.error("Failed to fetch Slack contacts:", error);
    // Return empty array on error (bot will handle gracefully)
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
  if (!contactsCache) {
    return [];
  }

  const domainKeywords = {
    ml: ["ML", "AI", "Machine Learning", "LLM", "Neural", "Data Science"],
    backend: ["Backend", "API", "Database", "Server", "Infrastructure", "DevOps"],
    frontend: ["Frontend", "React", "UI", "UX", "Performance"],
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
