import "dotenv/config";

/**
 * Centralized, fail-fast environment configuration.
 *
 * Local/stdio mode (Claude Desktop, `npm run start` with no env vars set)
 * keeps working with everything except MCP_SHARED_PASSWORD optional — the
 * HTTP/OAuth phases require the full set and will refuse to boot without it.
 */

function optional(name: string): string | undefined {
  const v = process.env[name];
  return v && v.length > 0 ? v : undefined;
}

function required(name: string): string {
  const v = optional(name);
  if (!v) {
    throw new Error(
      `Missing required environment variable: ${name}. Set it in fold-mcp/.env or the host's environment.`
    );
  }
  return v;
}

export const config = {
  /** HTTP port for the remote (StreamableHTTP) transport. Render sets this automatically. */
  port: Number(optional("PORT") ?? 3000),

  /** Single shared password gating the OAuth /authorize page (Phase 4+). */
  get mcpSharedPassword(): string {
    return required("MCP_SHARED_PASSWORD");
  },

  /** Turso (libSQL) connection — required once the server is Turso-backed (Phase 2+). */
  get tursoUrl(): string {
    return required("TURSO_DATABASE_URL");
  },
  get tursoAuthToken(): string {
    return required("TURSO_AUTH_TOKEN");
  },

  /** Public HTTPS URL of the deployed server, used as the OAuth issuer + redirect validation (Phase 4+). */
  get publicBaseUrl(): string {
    return required("PUBLIC_BASE_URL");
  },
} as const;
