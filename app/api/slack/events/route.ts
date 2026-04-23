import { NextRequest, NextResponse } from "next/server";

async function postSlackMessage(channel: string, text: string) {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) {
    console.error("SLACK_BOT_TOKEN is missing");
    return;
  }

  const res = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ channel, text }),
  });

  const data = await res.json();
  console.log("Slack response:", data);

  if (!data.ok) {
    console.error("chat.postMessage failed", {
      error: data.error,
      channel,
      needed: data.needed,
      provided: data.provided,
    });
  }
}

async function openDirectMessageChannel(userId: string): Promise<string | null> {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) {
    console.error("SLACK_BOT_TOKEN is missing");
    return null;
  }

  const res = await fetch("https://slack.com/api/conversations.open", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ users: userId }),
  });

  const data = await res.json();
  if (!data.ok) {
    console.error("conversations.open failed", {
      error: data.error,
      userId,
      needed: data.needed,
      provided: data.provided,
    });
    return null;
  }

  return data.channel?.id ?? null;
}

export async function POST(req: NextRequest) {
  const body = await req.json();

  // Slack URL verification
  if (body.type === "url_verification") {
    return NextResponse.json({ challenge: body.challenge });
  }

  const event = body.event;

  // Ignore bot messages (prevents loops)
  if (!event || event.bot_id) {
    return NextResponse.json({ ok: true });
  }

  const channel = event.channel;
  const user = event.user;

  // Ignore Slack retries to avoid duplicate responses
  if (req.headers.get("x-slack-retry-num")) {
    return NextResponse.json({ ok: true });
  }

  if (!channel) {
    return NextResponse.json({ ok: true });
  }

  if (!user) {
    return NextResponse.json({ ok: true });
  }

  console.log("Event received from:", user);
  console.log("channel:", channel);
  console.log("channel_type:", event.channel_type);
  console.log("event_type:", event.type);

  const dmChannel = await openDirectMessageChannel(user);
  if (!dmChannel) {
    return NextResponse.json({ ok: true });
  }

  await postSlackMessage(dmChannel, "Got your message 👀");
  return NextResponse.json({ ok: true });
}
