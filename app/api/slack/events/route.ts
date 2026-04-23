import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';

type SlackEvent = {
  type?: string;
  user?: string;
  channel?: string;
  text?: string;
  ts?: string;
  bot_id?: string;
  subtype?: string;
  reaction?: string;
  item?: unknown;
};

/**
 * Validates the Slack request signature
 * Slack signs all requests with an HMAC signature in the X-Slack-Request-Timestamp header
 */
function verifySlackSignature(
  request: NextRequest,
  body: string
): boolean {
  const slackSigningSecret = process.env.SLACK_SIGNING_SECRET;
  if (!slackSigningSecret) {
    console.error('SLACK_SIGNING_SECRET not configured');
    return false;
  }

  const timestamp = request.headers.get('x-slack-request-timestamp');
  const slackSignature = request.headers.get('x-slack-signature');

  if (!timestamp || !slackSignature) {
    console.error('Missing Slack signature headers');
    return false;
  }

  // Check if the request is too old (older than 5 minutes)
  const requestTime = Math.floor(Date.now() / 1000);
  if (Math.abs(requestTime - parseInt(timestamp, 10)) > 300) {
    console.error('Request timestamp too old');
    return false;
  }

  // Compute the signature: v0=sha256(signing_secret + ":" + timestamp + ":" + body)
  const baseString = `v0:${timestamp}:${body}`;
  const hash = crypto
    .createHmac('sha256', slackSigningSecret)
    .update(baseString)
    .digest('hex');
  const computedSignature = `v0=${hash}`;

  // timingSafeEqual throws if buffer lengths differ
  const computed = Buffer.from(computedSignature);
  const provided = Buffer.from(slackSignature);
  if (computed.length !== provided.length) {
    return false;
  }

  // Use timing-safe comparison
  return crypto.timingSafeEqual(computed, provided);
}

export async function POST(request: NextRequest) {
  try {
    // Get the raw body for signature verification
    const body = await request.text();

    // Parse body once so we can handle Slack URL verification immediately.
    // During setup, this prevents false negatives if signing config is incomplete.
    const payload = JSON.parse(body);

    // Handle URL verification challenge (must return the raw challenge value)
    if (payload.type === 'url_verification' && typeof payload.challenge === 'string') {
      console.log('Slack verification challenge received');
      return new NextResponse(payload.challenge, {
        status: 200,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      });
    }

    // Verify the Slack signature
    if (!verifySlackSignature(request, body)) {
      console.error('Invalid Slack signature');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Handle events
    if (payload.type === 'event_callback') {
      const event = payload.event;
      console.log('Event received:', {
        type: event.type,
        user: event.user,
        ts: event.ts,
      });

      // Route to appropriate handler based on event type
      switch (event.type) {
        case 'app_mention':
          await handleAppMention(event);
          break;
        case 'message':
          await handleMessage(event);
          break;
        case 'reaction_added':
          await handleReactionAdded(event);
          break;
        default:
          console.log(`Unhandled event type: ${event.type}`);
      }

      // Always respond with 200 OK to acknowledge receipt
      return NextResponse.json({ ok: true });
    }

    // Unknown payload type
    console.warn('Unknown payload type:', payload.type);
    return NextResponse.json({ ok: false }, { status: 400 });
  } catch (error) {
    console.error('Error processing Slack event:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * Handle when the bot is mentioned in a channel or DM
 */
async function handleAppMention(
  event: SlackEvent
) {
  console.log('Handling app_mention', {
    user: event.user,
    channel: event.channel,
    text: event.text,
  });

  // TODO: Implement app mention handler
  // This is where you'll start the conversation flow
}

/**
 * Handle direct messages to the bot
 */
async function handleMessage(event: SlackEvent) {
  // Skip bot messages and message edits/deletions
  if (event.bot_id || event.subtype === 'message_deleted' || event.subtype === 'message_changed') {
    return;
  }

  console.log('Handling message', {
    user: event.user,
    channel: event.channel,
    text: event.text,
  });

  // TODO: Implement message handler
  // This is where you'll continue conversations
}

/**
 * Handle reaction additions (future: could be used for feedback)
 */
async function handleReactionAdded(
  event: SlackEvent
) {
  console.log('Handling reaction_added', {
    user: event.user,
    reaction: event.reaction,
    item: event.item,
  });

  // TODO: Implement reaction handler if needed
}
