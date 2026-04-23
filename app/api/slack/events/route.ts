import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const body = await req.json();

  // Slack URL verification
  if (body.type === "url_verification") {
    return NextResponse.json({ challenge: body.challenge });
  }

  const event = body.event;

  if (event?.type === "app_mention") {
    const text = event.text;
    const user = event.user;
    const channel = event.channel;

    console.log("Message:", text);

    // TEMP response (we’ll replace this later)
    await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        channel,
        text: "Got your message 👀",
      }),
    });
  }

  return NextResponse.json({ ok: true });
}
