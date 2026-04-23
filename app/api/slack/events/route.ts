import { createHmac, timingSafeEqual } from "node:crypto";

type SlackUrlVerificationPayload = {
  type: "url_verification";
  challenge: string;
};

type SlackMessageEvent = {
  type: "message";
  channel: string;
  channel_type?: string;
  bot_id?: string;
  subtype?: string;
  user?: string;
  text?: string;
  ts?: string;
};

type SlackEventCallbackPayload = {
  type: "event_callback";
  event: SlackMessageEvent;
};

type SlackPayload = SlackUrlVerificationPayload | SlackEventCallbackPayload;

const SLACK_SIGNATURE_HEADER = "x-slack-signature";
const SLACK_TIMESTAMP_HEADER = "x-slack-request-timestamp";
const MAX_REQUEST_AGE_SECONDS = 60 * 5;

function verifySlackSignature(request: Request, rawBody: string): boolean {
  const signingSecret = process.env.SLACK_SIGNING_SECRET;
  if (!signingSecret) {
    console.warn("SLACK_SIGNING_SECRET is not set, skipping verification.");
    return true;
  }
  const signature = request.headers.get(SLACK_SIGNATURE_HEADER);
  const timestamp = request.headers.get(SLACK_TIMESTAMP_HEADER);
  if (!signature || !timestamp) return false;
  const timestampNumber = Number(timestamp);
  if (!Number.isFinite(timestampNumber)) return false;
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestampNumber) > MAX_REQUEST_AGE_SECONDS) return false;
  const basestring = `v0:${timestamp}:${rawBody}`;
  const expectedSignature = `v0=${createHmac("sha256", signingSecret).update(basestring).digest("hex")}`;
  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);
  if (signatureBuffer.length !== expectedBuffer.length) return false;
  return timingSafeEqual(signatureBuffer, expectedBuffer);
}

async function postDmReply(channel: string, text: string): Promise<void> {
  const botToken = process.env.SLACK_BOT_TOKEN;
  if (!botToken) {
    console.warn("SLACK_BOT_TOKEN is not set.");
    return;
  }
  const response = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${botToken}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({
      channel,
      text
    }),
  });
  if (!response.ok) throw new Error(`Slack HTTP error: ${response.status}`);
  const body = (await response.json()) as { ok?: boolean; error?: string };
  if (!body.ok) throw new Error(`Slack API error: ${body.error ?? "unknown_error"}`);
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  if (!verifySlackSignature(request, rawBody)) {
    return Response.json({ ok: false, error: "invalid_signature" }, { status: 401 });
  }

  let payload: SlackPayload;
  try {
    payload = JSON.parse(rawBody) as SlackPayload;
  } catch {
    return Response.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  if (payload.type === "url_verification") {
    return Response.json({ challenge: payload.challenge });
  }

  if (payload.type === "event_callback") {
    const { event } = payload;
    const isUserDmMessage =
      event.type === "message" &&
      event.channel_type === "im" &&
      !event.bot_id &&
      !event.subtype &&
      !!event.user;

    if (isUserDmMessage) {
      try {
        // Post directly to event.channel — no conversations.open needed
        await postDmReply(event.channel, "hello world");
      } catch (error) {
        console.error("Failed to send DM reply:", error);
      }
    }
  }

  return Response.json({ ok: true });
}