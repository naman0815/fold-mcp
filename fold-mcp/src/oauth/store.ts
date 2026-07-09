import crypto from "crypto";
import type { Response } from "express";
import type {
  OAuthClientInformationFull,
  OAuthTokens,
  OAuthTokenRevocationRequest,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import type { OAuthRegisteredClientsStore } from "@modelcontextprotocol/sdk/server/auth/clients.js";
import type { OAuthServerProvider, AuthorizationParams } from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { InvalidGrantError, InvalidTokenError } from "@modelcontextprotocol/sdk/server/auth/errors.js";
import { getTurso } from "../db.js";
import { config } from "../config.js";
import { renderLoginPage } from "./loginPage.js";

const ACCESS_TOKEN_TTL_SECONDS = 90 * 24 * 3600; // long-lived: small trusted group, refresh rotation covers renewal
const AUTH_CODE_TTL_SECONDS = 5 * 60;

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function randomToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

function constantTimeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

class TursoClientsStore implements OAuthRegisteredClientsStore {
  async getClient(clientId: string): Promise<OAuthClientInformationFull | undefined> {
    const result = await getTurso().execute({
      sql: `SELECT metadata_json FROM oauth_clients WHERE client_id = ?`,
      args: [clientId],
    });
    if (!result.rows.length) return undefined;
    return JSON.parse((result.rows[0] as any)[0]) as OAuthClientInformationFull;
  }

  async registerClient(
    client: Omit<OAuthClientInformationFull, "client_id" | "client_id_issued_at">
  ): Promise<OAuthClientInformationFull> {
    const full: OAuthClientInformationFull = {
      ...client,
      client_id: crypto.randomUUID(),
      client_id_issued_at: nowSeconds(),
    };
    await getTurso().execute({
      sql: `INSERT INTO oauth_clients (client_id, client_secret, metadata_json) VALUES (?, ?, ?)`,
      args: [full.client_id, full.client_secret ?? null, JSON.stringify(full)],
    });
    return full;
  }
}

/**
 * A from-scratch OAuthServerProvider (not ProxyOAuthServerProvider — there's no
 * upstream IdP here, this server IS the authorization server). Storage-backed by
 * Turso; the SDK's mcpAuthRouter handles all OAuth 2.1 wire protocol (metadata,
 * DCR, PKCE verification, token endpoint semantics) — this class only implements
 * the business logic: who's allowed in (the one shared password) and how codes
 * and tokens are issued/verified/revoked.
 */
export class TursoOAuthProvider implements OAuthServerProvider {
  clientsStore = new TursoClientsStore();

  async authorize(client: OAuthClientInformationFull, params: AuthorizationParams, res: Response): Promise<void> {
    const req = res.req;
    const submittedPassword = req?.method === "POST" ? (req.body?.password as string | undefined) : undefined;

    if (submittedPassword === undefined) {
      res.status(200).type("html").send(renderLoginPage({ client, params }));
      return;
    }

    if (!constantTimeEqual(submittedPassword, config.mcpSharedPassword)) {
      res.status(401).type("html").send(renderLoginPage({ client, params, error: "Incorrect password." }));
      return;
    }

    const code = randomToken();
    await getTurso().execute({
      sql: `INSERT INTO oauth_codes (code, client_id, redirect_uri, code_challenge, scopes, expires_at)
            VALUES (?, ?, ?, ?, ?, ?)`,
      args: [
        code,
        client.client_id,
        params.redirectUri,
        params.codeChallenge,
        params.scopes?.join(" ") ?? "",
        nowSeconds() + AUTH_CODE_TTL_SECONDS,
      ],
    });

    const redirectUrl = new URL(params.redirectUri);
    redirectUrl.searchParams.set("code", code);
    if (params.state !== undefined) redirectUrl.searchParams.set("state", params.state);
    res.redirect(302, redirectUrl.toString());
  }

  async challengeForAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string
  ): Promise<string> {
    const row = await this.getCodeRow(authorizationCode);
    if (!row || row.clientId !== client.client_id) throw new InvalidGrantError("Invalid authorization code");
    if (row.used) throw new InvalidGrantError("Authorization code already used");
    if (row.expiresAt < nowSeconds()) throw new InvalidGrantError("Authorization code expired");
    return row.codeChallenge;
  }

  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string
  ): Promise<OAuthTokens> {
    const row = await this.getCodeRow(authorizationCode);
    if (!row || row.clientId !== client.client_id) throw new InvalidGrantError("Invalid authorization code");
    if (row.used) throw new InvalidGrantError("Authorization code already used");
    if (row.expiresAt < nowSeconds()) throw new InvalidGrantError("Authorization code expired");

    await getTurso().execute({ sql: `UPDATE oauth_codes SET used = 1 WHERE code = ?`, args: [authorizationCode] });
    return this.issueTokens(client.client_id, row.scopes);
  }

  async exchangeRefreshToken(
    client: OAuthClientInformationFull,
    refreshToken: string,
    scopes?: string[]
  ): Promise<OAuthTokens> {
    const result = await getTurso().execute({
      sql: `SELECT client_id, scopes FROM oauth_tokens WHERE refresh_token = ?`,
      args: [refreshToken],
    });
    if (!result.rows.length) throw new InvalidGrantError("Invalid refresh token");
    const row = result.rows[0] as any;
    const clientId = row.client_id as string;
    const storedScopes = row.scopes as string | null;
    if (clientId !== client.client_id) throw new InvalidGrantError("Refresh token was not issued to this client");

    await getTurso().execute({ sql: `DELETE FROM oauth_tokens WHERE refresh_token = ?`, args: [refreshToken] });
    return this.issueTokens(client.client_id, scopes ?? splitScopes(storedScopes));
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const result = await getTurso().execute({
      sql: `SELECT client_id, scopes, expires_at FROM oauth_tokens WHERE access_token = ?`,
      args: [token],
    });
    if (!result.rows.length) throw new InvalidTokenError("Invalid access token");
    const row = result.rows[0] as any;
    const clientId = row.client_id as string;
    const scopes = row.scopes as string | null;
    const expiresAt = row.expires_at as number;
    if (expiresAt < nowSeconds()) throw new InvalidTokenError("Access token expired");
    return { token, clientId, scopes: splitScopes(scopes), expiresAt };
  }

  async revokeToken(client: OAuthClientInformationFull, request: OAuthTokenRevocationRequest): Promise<void> {
    await getTurso().batch(
      [
        { sql: `DELETE FROM oauth_tokens WHERE access_token = ? AND client_id = ?`, args: [request.token, client.client_id] },
        { sql: `DELETE FROM oauth_tokens WHERE refresh_token = ? AND client_id = ?`, args: [request.token, client.client_id] },
      ],
      "write"
    );
  }

  private async getCodeRow(
    code: string
  ): Promise<{ clientId: string; codeChallenge: string; scopes: string[]; expiresAt: number; used: boolean } | null> {
    const result = await getTurso().execute({
      sql: `SELECT client_id, code_challenge, scopes, expires_at, used FROM oauth_codes WHERE code = ?`,
      args: [code],
    });
    if (!result.rows.length) return null;
    const row = result.rows[0] as any;
    return {
      clientId: row.client_id as string,
      codeChallenge: row.code_challenge as string,
      scopes: splitScopes(row.scopes as string | null),
      expiresAt: row.expires_at as number,
      used: Boolean(row.used),
    };
  }

  private async issueTokens(clientId: string, scopes: string[]): Promise<OAuthTokens> {
    const accessToken = randomToken();
    const refreshToken = randomToken();
    await getTurso().execute({
      sql: `INSERT INTO oauth_tokens (access_token, refresh_token, client_id, scopes, expires_at) VALUES (?, ?, ?, ?, ?)`,
      args: [accessToken, refreshToken, clientId, scopes.join(" "), nowSeconds() + ACCESS_TOKEN_TTL_SECONDS],
    });
    return {
      access_token: accessToken,
      token_type: "bearer",
      expires_in: ACCESS_TOKEN_TTL_SECONDS,
      refresh_token: refreshToken,
      scope: scopes.join(" ") || undefined,
    };
  }
}

function splitScopes(scopes: string | null | undefined): string[] {
  return scopes ? scopes.split(" ").filter(Boolean) : [];
}
