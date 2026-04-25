import { createOAuthState } from "@/lib/slack-installations";

function getRedirectUri(request: Request): string {
  if (process.env.SLACK_REDIRECT_URI) {
    return process.env.SLACK_REDIRECT_URI;
  }

  const url = new URL(request.url);
  return `${url.origin}/api/slack/oauth/callback`;
}

function getScopes(): string {
  return process.env.SLACK_OAUTH_SCOPES || "chat:write,im:history,im:read,im:write,users:read";
}

export async function GET(request: Request) {
  const clientId = process.env.SLACK_CLIENT_ID;
  if (!clientId) {
    return Response.json({ ok: false, error: "missing_slack_client_id" }, { status: 500 });
  }

  let state: string;
  try {
    state = createOAuthState();
  } catch (error) {
    console.error("[OAuth] Failed to create state:", error);
    return Response.json({ ok: false, error: "oauth_state_not_configured" }, { status: 500 });
  }

  const params = new URLSearchParams({
    client_id: clientId,
    scope: getScopes(),
    redirect_uri: getRedirectUri(request),
    state,
  });

  const installUrl = `https://slack.com/oauth/v2/authorize?${params.toString()}`;
  return Response.redirect(installUrl, 302);
}
