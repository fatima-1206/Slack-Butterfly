import { createHmac, timingSafeEqual } from "node:crypto";
import { analyzeConversation, analyzeRecommendationFeedback, rankContacts } from "@/lib/llm";
import {
  getConversation,
  createConversation,
  addMessageToConversation,
  resetConversation,
} from "@/lib/conversations";
import { getAllContacts } from "@/lib/contacts";

type UserProfile = {
  id: string;
  name: string;
  title?: string;
  isBot: boolean;
  role?: "developer" | "pm" | "designer" | "leadership" | "other";
};

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

async function getUserProfile(userId: string): Promise<UserProfile | null> {
  const botToken = process.env.SLACK_BOT_TOKEN;
  if (!botToken) {
    console.warn("SLACK_BOT_TOKEN is not set.");
    return null;
  }

  try {
    const response = await fetch("https://slack.com/api/users.info", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${botToken}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({ user: userId }),
    });

    const data = (await response.json()) as {
      ok?: boolean;
      user?: {
        id: string;
        real_name: string;
        profile?: { title?: string; real_name?: string; display_name?: string };
        is_bot?: boolean;
      };
    };

    if (!data.ok || !data.user) {
      return null;
    }

    const title = data.user.profile?.title || "";
    const name = data.user.real_name || data.user.profile?.display_name || "User";

    // Infer role from title
    const titleLower = title.toLowerCase();
    let role: UserProfile["role"] = "other";
    if (titleLower.includes("engineer") || titleLower.includes("developer")) {
      role = "developer";
    } else if (titleLower.includes("manager") || titleLower.includes("pm")) {
      role = "pm";
    } else if (titleLower.includes("designer")) {
      role = "designer";
    } else if (titleLower.includes("ceo") || titleLower.includes("cto") || titleLower.includes("founder") || titleLower.includes("lead")) {
      role = "leadership";
    }

    return {
      id: userId,
      name,
      title: title || undefined,
      isBot: data.user.is_bot || false,
      role,
    };
  } catch (error) {
    console.error("[UserProfile] Failed to fetch user info:", error);
    return null;
  }
}

function formatProblemSummary(problemState: any): string {
  const lines = [
    `*Problem Summary:*`,
    `• Type: ${problemState.problemType || "Not specified"}`,
    `• Summary: ${problemState.summary}`,
    `• Key Needs: ${problemState.keyNeeds?.join(", ") || "None"}`,
  ];
  if (problemState.constraints?.length) {
    lines.push(`• Constraints: ${problemState.constraints.join(", ")}`);
  }
  if (problemState.urgency) {
    lines.push(`• Urgency: ${problemState.urgency}`);
  }
  if (problemState.domain) {
    lines.push(`• Domain: ${problemState.domain}`);
  }
  return lines.join("\n");
}

async function postDmReply(channel: string, text: string): Promise<void> {
  const botToken = process.env.SLACK_BOT_TOKEN;
  if (!botToken) {
    console.warn("SLACK_BOT_TOKEN is not set.");
    return;
  }

  console.log(`[Slack] Sending message to channel ${channel}, length: ${text.length}`);

  const response = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${botToken}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({
      channel,
      text,
    }),
  });

  if (!response.ok) {
    console.error(`[Slack] HTTP error: ${response.status}`);
    throw new Error(`Slack HTTP error: ${response.status}`);
  }

  const body = (await response.json()) as { ok?: boolean; error?: string; ts?: string };
  if (!body.ok) {
    console.error(`[Slack] API error: ${body.error ?? "unknown_error"}`);
    throw new Error(`Slack API error: ${body.error ?? "unknown_error"}`);
  }

  console.log(`[Slack] Message sent successfully (ts: ${body.ts})`);
}

// Track recent events to prevent duplicate processing
const recentEvents = new Map<string, number>();
const EVENT_DEDUP_WINDOW = 3000; // 3 seconds

export async function POST(request: Request) {
  console.log("[Route] Incoming Slack event");

  const rawBody = await request.text();

  if (!verifySlackSignature(request, rawBody)) {
    console.warn("[Route] Invalid signature");
    return Response.json({ ok: false, error: "invalid_signature" }, { status: 401 });
  }

  let payload: SlackPayload;
  try {
    payload = JSON.parse(rawBody) as SlackPayload;
  } catch (error) {
    console.error("[Route] Invalid JSON payload:", error);
    return Response.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  if (payload.type === "url_verification") {
    console.log("[Route] URL verification challenge");
    return Response.json({ challenge: payload.challenge });
  }

  if (payload.type === "event_callback") {
    const { event } = payload;

    // Dedup check using event ts (timestamp) + user
    const eventKey = `${event.user || "unknown"}-${event.ts || Date.now()}`;
    const lastSeen = recentEvents.get(eventKey);
    if (lastSeen && Date.now() - lastSeen < EVENT_DEDUP_WINDOW) {
      console.log(`[Route] Duplicate event detected (${eventKey}), ignoring`);
      return Response.json({ ok: true });
    }

    recentEvents.set(eventKey, Date.now());
    // Cleanup old entries
    if (recentEvents.size > 100) {
      const oldestKey = recentEvents.keys().next().value;
      if (oldestKey) {
        recentEvents.delete(oldestKey);
      }
    }

    const isUserDmMessage =
      event.type === "message" &&
      event.channel_type === "im" &&
      !event.bot_id &&
      !event.subtype &&
      !!event.user;

    console.log(
      `[Route] Event: type=${event.type}, channel_type=${event.channel_type}, bot_id=${event.bot_id}, subtype=${event.subtype}, isUserDm=${isUserDmMessage}`
    );

    if (isUserDmMessage && event.text && event.user && event.channel) {
      const userId = event.user;
      const userMessage = event.text.trim();
      const channelId = event.channel;

      console.log(`[Route] Processing DM from ${userId}: "${userMessage.substring(0, 50)}..."`);

      // Process async, but respond to Slack immediately
      processUserMessage(userId, userMessage, channelId).catch((error) => {
        console.error("[Route] Background processing error:", error);
      });

      // Return 200 OK immediately to acknowledge receipt
      return Response.json({ ok: true });
    }

    console.log("[Route] Event does not match DM criteria");
  }

  return Response.json({ ok: true });
}

async function processUserMessage(userId: string, userMessage: string, channelId: string) {
  try {
    console.log(`[Process] Starting for user ${userId}`);

    // Fetch user profile for context awareness
    const userProfile = await getUserProfile(userId);
    console.log(`[Process] User profile: role=${userProfile?.role}, title=${userProfile?.title}`);

    // Handle special commands
    const commandMatch = userMessage.trim().toLowerCase();

    if (commandMatch === "reset") {
      console.log(`[Process] Handling 'reset' command for user ${userId}`);
      await resetConversation(userId);
      await postDmReply(
        channelId,
        "Conversation reset. Tell me about a problem you need help solving."
      );
      return;
    }

    if (commandMatch === "status" || commandMatch === "show problem") {
      console.log(`[Process] Handling 'status' command for user ${userId}`);
      const conversation = await getConversation(userId);
      if (!conversation) {
        await postDmReply(channelId, "No active conversation. Tell me about a problem you need help solving.");
      } else if (!conversation.problemState || !conversation.problemState.summary) {
        await postDmReply(channelId, "I haven't captured a problem statement yet. Share more about what you need help with.");
      } else {
        const statusMsg = `${formatProblemSummary(conversation.problemState)}\n\nConfidence: ${(conversation.confidence * 100).toFixed(0)}% | Messages: ${conversation.messages.length} | State: ${conversation.state}`;
        await postDmReply(channelId, statusMsg);
      }
      return;
    }

    if (commandMatch === "help") {
      console.log(`[Process] Handling 'help' command for user ${userId}`);
      const helpText = `*Available commands:*\n• *status* or *show problem* - See my understanding of your problem\n• *reset* - Start over with a new problem\n• *help* - Show this message\n\n*How to use me:*\n1. Describe a problem you need help solving\n2. I'll ask clarifying questions to understand better\n3. Once I have enough context, I'll recommend people who can help\n4. Feedback helps me refine: "more backend people" or "that person isn't relevant"`;
      await postDmReply(channelId, helpText);
      return;
    }

    // Get or create conversation
    console.log(`[Process] Fetching conversation for user ${userId}`);
    let conversation = await getConversation(userId);
    if (!conversation) {
      console.log(`[Process] Conversation not found, creating new one for user ${userId}`);
      conversation = await createConversation(userId);
    }
    console.log(
      `[Process] Conversation state: ${conversation.state}, confidence: ${conversation.confidence}, messages: ${conversation.messages.length}`
    );

    // Convert conversation history to LLM format
    const llmHistory = conversation.messages.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

    console.log(`[Process] Analyzing message with LLM (history length: ${llmHistory.length})`);

    const isRecommendationFollowUp = conversation.state === "recommending";
    const analysis = isRecommendationFollowUp
      ? await analyzeRecommendationFeedback(userMessage, conversation.problemState, llmHistory)
      : await analyzeConversation(userMessage, llmHistory);

    console.log(
      `[Process] LLM analysis: nextAction=${analysis.nextAction}, confidence=${analysis.confidence}, missingFields=${analysis.missingFields.join(", ")}`
    );

    // Determine the response
    let botResponse: string;

    if (analysis.nextAction === "ready_to_recommend" || analysis.nextAction === "refine") {
      console.log(`[Process] Entering recommendation mode${analysis.nextAction === "refine" ? " (refinement)" : ""}`);
      // We have enough info to recommend contacts
      console.log(`[Process] Fetching contacts from Slack`);
      const allContacts = await getAllContacts();
      console.log(`[Process] Fetched ${allContacts.length} contacts`);
      const contactsById = new Map(allContacts.map((c) => [c.id, c]));

      console.log(
        `[Process] Ranking contacts for problem state: ${JSON.stringify(analysis.updatedState).substring(0, 100)}`
      );
      const recommendations = await rankContacts(
        analysis.updatedState,
        allContacts,
        analysis.refinement,
        userProfile?.role
      );
      console.log(`[Process] Got ${recommendations.length} recommendations`);

      if (recommendations.length === 0) {
        const refinementText = analysis.refinement?.preferredDirections?.length
          ? `I tuned the search toward ${analysis.refinement.preferredDirections.join(", ")}, but still couldn't find strong matches in the current contact list yet.`
          : "I couldn't find strong matches in the current contact list yet.";

        botResponse = `${refinementText} If you want, give me one more direction to bias toward and I’ll try again.`;
      } else {
        // Format recommendations with Block Kit-friendly text
        const recommendationText = recommendations
          .map((rec, idx) => {
            const contact = contactsById.get(rec.contactId);
            const displayName = contact?.name || rec.contactId;
            const displayTitle = contact?.title ? ` (${contact.title})` : "";
            const askLine = rec.suggestedAsk ? `\n   Ask them: "${rec.suggestedAsk}"` : "";
            return `${idx + 1}. *${displayName}*${displayTitle} - ${rec.why}\n   Score: ${(rec.score * 100).toFixed(0)}%${askLine}`;
          })
          .join("\n\n");

        const refinementHint =
          analysis.nextAction === "refine" && analysis.refinement?.preferredDirections?.length
            ? `\n\nI biased this round toward ${analysis.refinement.preferredDirections.join(", ")}.`
            : "";

        botResponse = `Great! I found ${recommendations.length} people who might help:\n\n${recommendationText}${refinementHint}\n\n_Type "status" to see my understanding of the problem, or give me feedback to refine the results._`;
      }

      console.log(`[Process] Updating conversation to recommending state`);
      // Update conversation to recommending state
      await addMessageToConversation(
        userId,
        { role: "user", content: userMessage },
        analysis.updatedState,
        analysis.confidence,
        "recommending"
      );
    } else {
      console.log(`[Process] Entering clarification mode`);
      // Need more clarification
      const clarificationText = analysis.clarificationQuestions
        .slice(0, 2) // Limit to 2 questions for brevity
        .join("\n\n");

      botResponse =
        clarificationText ||
        "Can you tell me more about what you need help with?";

      console.log(`[Process] Clarification questions: ${analysis.clarificationQuestions.length}`);
      // Update conversation with clarification state
      await addMessageToConversation(
        userId,
        { role: "user", content: userMessage },
        analysis.updatedState,
        analysis.confidence,
        "clarifying"
      );
    }

    console.log(`[Process] Saving bot response to conversation`);
    // Add bot response to conversation
    await addMessageToConversation(
      userId,
      { role: "assistant", content: botResponse },
      analysis.updatedState,
      analysis.confidence,
      analysis.nextAction === "ready_to_recommend" || analysis.nextAction === "refine"
        ? "recommending"
        : "clarifying"
    );

    console.log(`[Process] Sending response to Slack (length: ${botResponse.length})`);
    // Send response to user
    await postDmReply(channelId, botResponse);
    console.log(`[Process] Completed successfully for user ${userId}`);
  } catch (error) {
    console.error("[Process] Error processing message:", error);
    try {
      console.log(`[Process] Sending error message to user`);
      await postDmReply(
        channelId,
        "Sorry, something went wrong. Please try again or type 'reset' to start over."
      );
    } catch (sendError) {
      console.error("[Process] Failed to send error message:", sendError);
    }
  }
}