import { saveInstallation, verifyOAuthState, type SlackInstallation } from "@/lib/slack-installations";

type OAuthAccessResponse = {
  ok: boolean;
  error?: string;
  access_token?: string;
  scope?: string;
  app_id?: string;
  team?: {
    id?: string;
    name?: string;
  };
  bot_user_id?: string;
  authed_user?: {
    id?: string;
  };
};

function getRedirectUri(request: Request): string {
  if (process.env.SLACK_REDIRECT_URI) {
    return process.env.SLACK_REDIRECT_URI;
  }

  const url = new URL(request.url);
  return `${url.origin}/api/slack/oauth/callback`;
}

function buildHtml(title: string, message: string): string {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>${title}</title>
    <style>
      body { font-family: -apple-system, Segoe UI, sans-serif; margin: 2rem; color: #111827; }
      .box { max-width: 680px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 12px; padding: 20px; }
      h1 { margin-top: 0; font-size: 1.2rem; }
      p { line-height: 1.5; }
    </style>
  </head>
  <body>
    <div class="box">
      <h1>${title}</h1>
      <p>${message}</p>
    </div>
  </body>
</html>`;
}

export async function GET(request: Request) {
  const clientId = process.env.SLACK_CLIENT_ID;
  const clientSecret = process.env.SLACK_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return new Response(buildHtml("Slack OAuth Setup Error", "Missing SLACK_CLIENT_ID or SLACK_CLIENT_SECRET in environment."), {
      status: 500,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");

  if (oauthError) {
    return new Response(buildHtml("Slack Install Cancelled", `Slack returned: ${oauthError}`), {
      status: 400,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  if (!code || !state) {
    return new Response(buildHtml("Slack OAuth Error", "Missing code or state from Slack callback."), {
      status: 400,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  if (!verifyOAuthState(state)) {
    return new Response(buildHtml("Slack OAuth Error", "Invalid or expired OAuth state. Please try install again."), {
      status: 400,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  const response = await fetch("https://slack.com/api/oauth.v2.access", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: getRedirectUri(request),
    }),
  });

  const body = (await response.json()) as OAuthAccessResponse;
  if (!response.ok || !body.ok || !body.team?.id || !body.access_token) {
    console.error("[OAuth] oauth.v2.access failed:", body);
    return new Response(buildHtml("Slack OAuth Error", `oauth.v2.access failed: ${body.error || "unknown_error"}`), {
      status: 400,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  const installation: SlackInstallation = {
    teamId: body.team.id,
    teamName: body.team.name,
    botToken: body.access_token,
    botUserId: body.bot_user_id,
    scope: body.scope,
    appId: body.app_id,
    authedUserId: body.authed_user?.id,
    installedAt: Date.now(),
    updatedAt: Date.now(),
  };

  try {
    await saveInstallation(installation);
  } catch (error) {
    console.error("[OAuth] Failed to persist installation:", error);
    return new Response(buildHtml("Slack OAuth Error", "Installed in Slack but failed to persist token in Firestore."), {
      status: 500,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  return new Response(
    buildHtml(
      "Slack Butterfly Installed",
      `Workspace ${installation.teamName || installation.teamId} is connected. You can return to Slack and DM the bot.`
    ),
    {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    }
  );
}
