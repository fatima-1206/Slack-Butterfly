/**
 * Slack API utility functions
 * Used for sending messages and managing conversations
 */

interface SlackMessage {
  channel: string;
  text?: string;
  blocks?: Record<string, any>[];
  thread_ts?: string;
}

interface SlackUser {
  id: string;
  real_name: string;
  profile: {
    email?: string;
    display_name?: string;
    title?: string;
  };
}

const SLACK_API_BASE = 'https://slack.com/api';
const BOT_TOKEN = process.env.SLACK_BOT_TOKEN;

/**
 * Send a message to a Slack channel or user
 */
export async function sendSlackMessage(message: SlackMessage): Promise<{
  ok: boolean;
  ts?: string;
  error?: string;
}> {
  if (!BOT_TOKEN) {
    throw new Error('SLACK_BOT_TOKEN not configured');
  }

  try {
    const response = await fetch(`${SLACK_API_BASE}/chat.postMessage`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${BOT_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(message),
    });

    const data = await response.json();

    if (!data.ok) {
      console.error('Slack API error:', data.error);
      return {
        ok: false,
        error: data.error,
      };
    }

    return {
      ok: true,
      ts: data.ts,
    };
  } catch (error) {
    console.error('Error sending Slack message:', error);
    return {
      ok: false,
      error: String(error),
    };
  }
}

/**
 * Send a message with Block Kit formatting
 */
export async function sendSlackBlockMessage(
  channel: string,
  blocks: Record<string, any>[],
  threadTs?: string
): Promise<{ ok: boolean; ts?: string; error?: string }> {
  return sendSlackMessage({
    channel,
    blocks,
    thread_ts: threadTs,
  });
}

/**
 * Get user information from Slack
 */
export async function getSlackUser(userId: string): Promise<SlackUser | null> {
  if (!BOT_TOKEN) {
    throw new Error('SLACK_BOT_TOKEN not configured');
  }

  try {
    const response = await fetch(
      `${SLACK_API_BASE}/users.info?user=${encodeURIComponent(userId)}`,
      {
        headers: {
          'Authorization': `Bearer ${BOT_TOKEN}`,
        },
      }
    );

    const data = await response.json();

    if (!data.ok) {
      console.error('Slack API error:', data.error);
      return null;
    }

    return data.user;
  } catch (error) {
    console.error('Error fetching Slack user:', error);
    return null;
  }
}

/**
 * Get list of workspace members
 */
export async function getWorkspaceMembers(): Promise<SlackUser[]> {
  if (!BOT_TOKEN) {
    throw new Error('SLACK_BOT_TOKEN not configured');
  }

  try {
    const response = await fetch(
      `${SLACK_API_BASE}/users.list?limit=1000`,
      {
        headers: {
          'Authorization': `Bearer ${BOT_TOKEN}`,
        },
      }
    );

    const data = await response.json();

    if (!data.ok) {
      console.error('Slack API error:', data.error);
      return [];
    }

    // Filter out bots and deactivated users
    return data.members.filter(
      (user: any) =>
        !user.is_bot &&
        !user.deleted &&
        user.id !== 'USLACKBOT' &&
        user.real_name !== ''
    );
  } catch (error) {
    console.error('Error fetching workspace members:', error);
    return [];
  }
}

/**
 * Opens a modal dialog with the user
 */
export async function openModal(
  triggerId: string,
  view: Record<string, any>
): Promise<{ ok: boolean; error?: string }> {
  if (!BOT_TOKEN) {
    throw new Error('SLACK_BOT_TOKEN not configured');
  }

  try {
    const response = await fetch(`${SLACK_API_BASE}/views.open`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${BOT_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        trigger_id: triggerId,
        view,
      }),
    });

    const data = await response.json();

    if (!data.ok) {
      console.error('Slack API error:', data.error);
      return {
        ok: false,
        error: data.error,
      };
    }

    return { ok: true };
  } catch (error) {
    console.error('Error opening Slack modal:', error);
    return {
      ok: false,
      error: String(error),
    };
  }
}
