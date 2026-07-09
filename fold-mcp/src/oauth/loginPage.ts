import type { OAuthClientInformationFull } from "@modelcontextprotocol/sdk/shared/auth.js";
import type { AuthorizationParams } from "@modelcontextprotocol/sdk/server/auth/provider.js";

function esc(s: string | undefined): string {
  if (!s) return "";
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Minimal, dependency-free login form. Renders every original OAuth param as a
 * hidden field so the POST back to /authorize carries the full request again —
 * the SDK's authorizationHandler reads from req.body on POST, req.query on GET.
 */
export function renderLoginPage(opts: {
  client: OAuthClientInformationFull;
  params: AuthorizationParams;
  error?: string;
}): string {
  const { client, params, error } = opts;
  const hidden = (name: string, value: string | undefined) =>
    value !== undefined ? `<input type="hidden" name="${esc(name)}" value="${esc(value)}">` : "";

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Fold MCP — Sign in</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #0b0d12; color: #eaeaea;
           display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
    form { background: #14171f; padding: 2rem; border-radius: 12px; width: 100%; max-width: 320px; box-shadow: 0 4px 24px rgba(0,0,0,.4); }
    h1 { font-size: 1.1rem; margin: 0 0 1.25rem; }
    p.sub { font-size: .85rem; color: #9aa0ab; margin: -1rem 0 1.25rem; }
    input[type=password] { width: 100%; box-sizing: border-box; padding: .6rem .7rem; border-radius: 8px; border: 1px solid #2a2f3a;
           background: #0b0d12; color: #eaeaea; font-size: 1rem; margin-bottom: 1rem; }
    button { width: 100%; padding: .65rem; border-radius: 8px; border: none; background: #4f7cff; color: white;
             font-size: 1rem; cursor: pointer; }
    button:hover { background: #3d68ee; }
    .error { color: #ff6b6b; font-size: .85rem; margin: -0.5rem 0 1rem; }
  </style>
</head>
<body>
  <form method="POST">
    <h1>Sign in to Fold MCP</h1>
    <p class="sub">${esc(client.client_name) || "An app"} wants to access your linked Fold accounts.</p>
    ${error ? `<div class="error">${esc(error)}</div>` : ""}
    <input type="password" name="password" placeholder="Shared password" autofocus required>
    ${hidden("client_id", client.client_id)}
    ${hidden("redirect_uri", params.redirectUri)}
    ${hidden("response_type", "code")}
    ${hidden("code_challenge", params.codeChallenge)}
    ${hidden("code_challenge_method", "S256")}
    ${hidden("scope", params.scopes?.join(" "))}
    ${hidden("state", params.state)}
    ${hidden("resource", params.resource?.toString())}
    <button type="submit">Sign in</button>
  </form>
</body>
</html>`;
}
