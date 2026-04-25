import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { getFirestore } from "@/lib/firebase";

const INSTALLATIONS_COLLECTION = "slackInstallations";
const STATE_WINDOW_SECONDS = 10 * 60;

export type SlackInstallation = {
  teamId: string;
  teamName?: string;
  botToken: string;
  botUserId?: string;
  scope?: string;
  appId?: string;
  authedUserId?: string;
  installedAt: number;
  updatedAt: number;
};

export async function getStoredBotToken(workspaceId: string): Promise<string | null> {
  try {
    const db = getFirestore();
    const doc = await db.collection(INSTALLATIONS_COLLECTION).doc(workspaceId).get();
    if (!doc.exists) {
      return null;
    }

    const data = doc.data() as Partial<SlackInstallation> | undefined;
    if (!data?.botToken || typeof data.botToken !== "string") {
      return null;
    }

    return data.botToken;
  } catch (error) {
    console.error(`[SlackInstall] Failed to load bot token for workspace ${workspaceId}:`, error);
    return null;
  }
}

export async function saveInstallation(installation: SlackInstallation): Promise<void> {
  const db = getFirestore();
  await db
    .collection(INSTALLATIONS_COLLECTION)
    .doc(installation.teamId)
    .set(
      {
        ...installation,
        updatedAt: Date.now(),
      },
      { merge: true }
    );
}

function getStateSecret(): string {
  return process.env.SLACK_OAUTH_STATE_SECRET || process.env.SLACK_SIGNING_SECRET || "";
}

export function createOAuthState(): string {
  const secret = getStateSecret();
  if (!secret) {
    throw new Error("SLACK_OAUTH_STATE_SECRET or SLACK_SIGNING_SECRET must be set for OAuth state validation.");
  }

  const ts = Math.floor(Date.now() / 1000).toString();
  const nonce = randomBytes(12).toString("hex");
  const payload = `${ts}.${nonce}`;
  const sig = createHmac("sha256", secret).update(payload).digest("hex");
  return `${payload}.${sig}`;
}

export function verifyOAuthState(state: string): boolean {
  const secret = getStateSecret();
  if (!secret) {
    return false;
  }

  const parts = state.split(".");
  if (parts.length !== 3) {
    return false;
  }

  const [tsStr, nonce, providedSig] = parts;
  const ts = Number(tsStr);
  if (!Number.isFinite(ts) || !nonce || !providedSig) {
    return false;
  }

  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > STATE_WINDOW_SECONDS) {
    return false;
  }

  const payload = `${tsStr}.${nonce}`;
  const expectedSig = createHmac("sha256", secret).update(payload).digest("hex");
  const expectedBuffer = Buffer.from(expectedSig);
  const providedBuffer = Buffer.from(providedSig);

  if (expectedBuffer.length !== providedBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, providedBuffer);
}
