import { createHmac, timingSafeEqual } from "node:crypto";
import { analyzeConversation, rankContacts } from "@/lib/llm";
import {
  getConversation,
  createConversation,
  addMessageToConversation,
  resetConversation,
} from "@/lib/conversations";
import { getAllContacts } from "@/lib/contacts";

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

    if (isUserDmMessage && event.text && event.user && event.channel) {
      const userId = event.user;
      const userMessage = event.text.trim();
      const channelId = event.channel;

      try {
        // Handle special commands
        if (userMessage.toLowerCase() === "reset") {
          await resetConversation(userId);
          await postDmReply(
            channelId,
            "Conversation reset. Tell me about a problem you need help solving."
          );
          return Response.json({ ok: true });
        }

        // Get or create conversation
        let conversation = await getConversation(userId);
        if (!conversation) {
          conversation = await createConversation(userId);
        }

        // Convert conversation history to LLM format
        const llmHistory = conversation.messages.map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        }));

        // Analyze the message with LLM
        const analysis = await analyzeConversation(userMessage, llmHistory);

        // Determine the response
        let botResponse: string;

        if (analysis.nextAction === "ready_to_recommend") {
          // We have enough info to recommend contacts
          const allContacts = getAllContacts();
          const recommendations = await rankContacts(analysis.updatedState, allContacts);

          if (recommendations.length === 0) {
            botResponse =
              "I couldn't find good matches in the contact list. Can you tell me more about what you're looking for?";
          } else {
            // Format recommendations with Block Kit-friendly text
            const recommendationText = recommendations
              .map(
                (rec, idx) =>
                  `${idx + 1}. *${rec.contactId}* - ${rec.why}\n   Score: ${(rec.score * 100).toFixed(0)}%`
              )
              .join("\n\n");

            botResponse = `Great! I found ${recommendations.length} people who might help:\n\n${recommendationText}\n\nWould any of these be useful? You can tell me to reach out to someone, or I can search for others.`;
          }

          // Update conversation to recommending state
          await addMessageToConversation(
            userId,
            { role: "user", content: userMessage },
            analysis.updatedState,
            analysis.confidence,
            "recommending"
          );
        } else {
          // Need more clarification
          const clarificationText = analysis.clarificationQuestions
            .slice(0, 2) // Limit to 2 questions for brevity
            .join("\n\n");

          botResponse = clarificationText ||
            "Can you tell me more about what you need help with?";

          // Update conversation with clarification state
          await addMessageToConversation(
            userId,
            { role: "user", content: userMessage },
            analysis.updatedState,
            analysis.confidence,
            "clarifying"
          );
        }

        // Add bot response to conversation
        await addMessageToConversation(
          userId,
          { role: "assistant", content: botResponse },
          analysis.updatedState,
          analysis.confidence,
          analysis.nextAction === "ready_to_recommend" ? "recommending" : "clarifying"
        );

        // Send response to user
        await postDmReply(channelId, botResponse);
      } catch (error) {
        console.error("Error processing message:", error);
        try {
          await postDmReply(
            channelId,
            "Sorry, something went wrong. Please try again or type 'reset' to start over."
          );
        } catch (sendError) {
          console.error("Failed to send error message:", sendError);
        }
      }
    }
  }

  return Response.json({ ok: true });
}