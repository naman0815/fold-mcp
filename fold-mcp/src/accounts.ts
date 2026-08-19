import { spawn } from "child_process";
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import yaml from "js-yaml";
import { getTurso, loadSqlJsDatabase, invalidateFtsCache } from "./db.js";
import type { InvestmentsData } from "./investments.js";

// ─── Paths (same resolution the old index.ts used for the Go binary) ────────
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const cliPath = path.resolve(__dirname, "..", "..",
  process.platform === "win32" ? "unfold_patched.exe" : "unfold_patched"
);
const cliDir = path.resolve(__dirname, "..", "..");

export interface FoldAccount {
  id: string;
  label: string;
  phone: string;
  foldUserUuid: string | null;
  status: "pending_otp" | "active" | "error";
  isActive: boolean;
  createdAt: string;
  lastSyncedAt: string | null;
}

function rowToAccount(r: any): FoldAccount {
  return {
    id: r.id,
    label: r.label,
    phone: r.phone,
    foldUserUuid: r.fold_user_uuid ?? null,
    status: r.status,
    isActive: Boolean(r.is_active),
    createdAt: r.created_at,
    lastSyncedAt: r.last_synced_at ?? null,
  };
}

async function getAccountRow(accountId: string): Promise<FoldAccount | null> {
  const result = await getTurso().execute({
    sql: `SELECT * FROM fold_accounts WHERE id = ?`,
    args: [accountId],
  });
  if (result.rows.length === 0) return null;
  const obj: any = {};
  result.columns.forEach((c, i) => { obj[c] = (result.rows[0] as any)[i]; });
  return rowToAccount(obj);
}

export async function listAccounts(): Promise<FoldAccount[]> {
  const result = await getTurso().execute(`SELECT * FROM fold_accounts ORDER BY created_at ASC`);
  return result.rows.map((row) => {
    const obj: any = {};
    result.columns.forEach((c, i) => { obj[c] = (row as any)[i]; });
    return rowToAccount(obj);
  });
}

function newAccountId(label: string): string {
  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-+|-+$)/g, "").slice(0, 24) || "account";
  return `${slug}-${crypto.randomBytes(3).toString("hex")}`;
}

export async function getAccountByPhone(phone: string): Promise<FoldAccount | null> {
  const result = await getTurso().execute({
    sql: `SELECT * FROM fold_accounts WHERE phone = ? ORDER BY created_at ASC LIMIT 1`,
    args: [phone],
  });
  if (result.rows.length === 0) return null;
  const obj: any = {};
  result.columns.forEach((c, i) => { obj[c] = (result.rows[0] as any)[i]; });
  return rowToAccount(obj);
}

export async function createAccount(label: string, phone: string): Promise<FoldAccount> {
  const id = newAccountId(label);
  await getTurso().execute({
    sql: `INSERT INTO fold_accounts (id, label, phone, status, is_active) VALUES (?, ?, ?, 'pending_otp', 0)`,
    args: [id, label, phone],
  });
  return (await getAccountRow(id))!;
}

export async function getActiveAccountId(): Promise<string | null> {
  const result = await getTurso().execute(`SELECT id FROM fold_accounts WHERE is_active = 1 LIMIT 1`);
  return result.rows.length ? (result.rows[0] as any)[0] : null;
}

export async function setActiveAccountId(accountId: string): Promise<void> {
  const account = await getAccountRow(accountId);
  if (!account) throw new Error(`No linked Fold account with id "${accountId}".`);
  await getTurso().batch(
    [
      { sql: `UPDATE fold_accounts SET is_active = 0`, args: [] },
      { sql: `UPDATE fold_accounts SET is_active = 1 WHERE id = ?`, args: [accountId] },
    ],
    "write"
  );
}

/** Resolves an `account` tool argument (id or label, case-insensitive) to an id, falling back to the active account. */
export async function resolveAccountId(explicit?: string): Promise<string> {
  if (explicit && explicit.trim()) {
    const needle = explicit.trim().toLowerCase();
    const accounts = await listAccounts();
    const match = accounts.find((a) => a.id.toLowerCase() === needle || a.label.toLowerCase() === needle);
    if (!match) {
      const known = accounts.map((a) => `"${a.label}" (${a.id})`).join(", ") || "none linked yet";
      throw new Error(`No linked Fold account matches "${explicit}". Known accounts: ${known}.`);
    }
    return match.id;
  }
  const active = await getActiveAccountId();
  if (!active) {
    throw new Error(
      "No Fold account is linked yet. Use add_fold_account to link one, then verify_fold_account_otp to complete login."
    );
  }
  return active;
}

/**
 * Strips anything that looks like a token/secret from CLI stderr/stdout before it's
 * embedded in an Error surfaced to the MCP client. Defense-in-depth on top of the
 * Go-side log redaction — catches any other sensitive-looking value (long base64/hex
 * tokens, `"access_token": "..."`, etc). The 40+ char threshold on the second pattern
 * keeps standard 36-char UUIDs (account ids) visible in error text for debugging.
 */
function scrubSecrets(s: string): string {
  return s
    .replace(/("?(?:access|refresh)_?token"?\s*[:=]\s*)"?[A-Za-z0-9_\-.]{16,}"?/gi, "$1[redacted]")
    .replace(/\b[A-Za-z0-9_-]{40,}\b/g, "[redacted-token-like-value]");
}

// ─── Bridging to unfold_patched (Go CLI) ─────────────────────────────────────
// Known quirk (verified in production, not something we've touched): on any
// error path, unfold_cli logs the error and calls runtime.Goexit() rather than
// os.Exit(), so main.go's `defer viper.WriteConfig()` still runs — but main.go
// also spawns a goroutine that blocks forever waiting for SIGINT, which keeps
// the process alive indefinitely afterward. Success paths return normally and
// exit promptly; only the error path hangs until we kill it at timeoutMs,
// which is why an error surfaces slowly (via the timeout's partial stderr)
// rather than immediately.
function runCli(args: string[], timeoutMs: number): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    // -v enables the CLI's debug logging (zerolog to stderr) so a timeout still
    // tells us how far the process got (e.g. "sent OTP request" vs hung before
    // even making the HTTP call) instead of giving zero diagnostic signal.
    const child = spawn(cliPath, [...args, "-v"], { cwd: cliDir });
    let stdout = "", stderr = "";
    child.stdout?.on("data", (d) => { stdout += d; });
    child.stderr?.on("data", (d) => { stderr += d; });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(
        `unfold_patched ${args.join(" ")} timed out after ${timeoutMs / 1000}s. ` +
        `Partial stdout: ${scrubSecrets(stdout.trim()) || "(none)"} | Partial stderr: ${scrubSecrets(stderr.trim()) || "(none)"}`
      ));
    }, timeoutMs);
    child.on("close", (code) => { clearTimeout(timer); resolve({ code: code ?? -1, stdout, stderr }); });
    child.on("error", (err) => { clearTimeout(timer); reject(err); });
  });
}

/** Writes this account's currently-known secrets to a scratch YAML file for one CLI invocation. */
async function materializeConfig(accountId: string): Promise<string> {
  const secretsResult = await getTurso().execute({
    sql: `SELECT access_token, refresh_token, device_hash FROM fold_account_secrets WHERE fold_account_id = ?`,
    args: [accountId],
  });
  const account = await getAccountRow(accountId);

  const data: any = {};
  if (secretsResult.rows.length) {
    const row = secretsResult.rows[0] as any;
    const accessToken = row.access_token;
    const refreshToken = row.refresh_token;
    const deviceHash = row.device_hash;
    data.device_hash = deviceHash;
    if (accessToken) data.token = { access: accessToken, refresh: refreshToken };
  }
  if (account?.foldUserUuid) data.fold_user = { uuid: account.foldUserUuid };

  const tmpPath = path.join(os.tmpdir(), `unfold-${accountId}-${crypto.randomUUID()}.yaml`);
  fs.writeFileSync(tmpPath, yaml.dump(data), "utf8");
  fs.chmodSync(tmpPath, 0o600); // contains access/refresh tokens — don't leave it world-readable
  return tmpPath;
}

/** Reads back whatever the CLI wrote (device_hash always; tokens/uuid once login/refresh succeed) into Turso. */
async function persistConfigBack(accountId: string, tmpConfigPath: string): Promise<void> {
  if (!fs.existsSync(tmpConfigPath)) return;
  const raw = (yaml.load(fs.readFileSync(tmpConfigPath, "utf8")) as any) ?? {};

  await getTurso().execute({
    sql: `INSERT INTO fold_account_secrets (fold_account_id, access_token, refresh_token, device_hash)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(fold_account_id) DO UPDATE SET
            access_token = excluded.access_token,
            refresh_token = excluded.refresh_token,
            device_hash = excluded.device_hash`,
    args: [
      accountId,
      raw?.token?.access ?? null,
      raw?.token?.refresh ?? null,
      raw?.device_hash ?? crypto.randomUUID(),
    ],
  });

  if (raw?.fold_user?.uuid) {
    await getTurso().execute({
      sql: `UPDATE fold_accounts SET fold_user_uuid = ? WHERE id = ?`,
      args: [raw.fold_user.uuid, accountId],
    });
  }
}

async function withTempConfig<T>(accountId: string, fn: (tmpConfigPath: string) => Promise<T>): Promise<T> {
  const tmpConfigPath = await materializeConfig(accountId);
  try {
    return await fn(tmpConfigPath);
  } finally {
    await persistConfigBack(accountId, tmpConfigPath).catch(() => {
      // Best-effort: if this fails, the account may need re-linking next use — surfaced
      // naturally as a login/refresh error rather than losing the whole request here.
    });
    fs.rmSync(tmpConfigPath, { force: true });
  }
}

export async function sendOtp(accountId: string): Promise<void> {
  const account = await getAccountRow(accountId);
  if (!account) throw new Error(`Unknown Fold account id: ${accountId}`);
  await withTempConfig(accountId, async (tmpConfigPath) => {
    const { code, stderr } = await runCli(
      ["login", "--phone", account.phone, "--send-otp", "--config", tmpConfigPath],
      75_000 // unfold_cli's own HTTP client times out at 60s — give it room to surface that error first
    );
    if (code !== 0) throw new Error(`Failed to send OTP to ${account.phone}: ${scrubSecrets(stderr.trim()) || "unknown error"}`);
  });
}

export async function verifyOtp(accountId: string, otp: string): Promise<void> {
  const account = await getAccountRow(accountId);
  if (!account) throw new Error(`Unknown Fold account id: ${accountId}`);
  await withTempConfig(accountId, async (tmpConfigPath) => {
    const { code, stderr } = await runCli(
      ["login", "--phone", account.phone, "--otp", otp, "--config", tmpConfigPath],
      75_000 // unfold_cli's own HTTP client times out at 60s — give it room to surface that error first
    );
    if (code !== 0) throw new Error(`OTP verification failed: ${scrubSecrets(stderr.trim()) || "unknown error"}`);
  });

  await getTurso().execute({ sql: `UPDATE fold_accounts SET status = 'active' WHERE id = ?`, args: [accountId] });

  const activeId = await getActiveAccountId();
  if (!activeId) await setActiveAccountId(accountId);
}

// ─── Sync ─────────────────────────────────────────────────────────────────────
const TX_COLUMNS = [
  "uuid", "amount", "current_balance", "timestamp", "type", "account",
  "merchant", "merchant_address", "narration", "category", "category_id", "subcategory",
  "tags", "kind", "mode", "reference", "notes", "excluded_from_cash_flow", "is_bookmarked",
  "summary", "transaction_id", "refund_status", "refund_received_on", "before_fold_account",
  "via", "account_in", "contact_id", "group_ids", "f1_predicted_category", "f1_predicted_merchant",
  "account_id",
];

const UPSERT_SQL = `
  INSERT INTO transactions (fold_account_id, ${TX_COLUMNS.join(", ")})
  VALUES (?, ${TX_COLUMNS.map(() => "?").join(", ")})
  ON CONFLICT(fold_account_id, uuid) DO UPDATE SET
    ${TX_COLUMNS.filter((c) => c !== "uuid").map((c) => `${c} = excluded.${c}`).join(",\n    ")}
`;

const BATCH_SIZE = 200;

/** Runs one unfold_patched sync for [from, to] against this account, then upserts results into Turso. */
export async function runSync(accountId: string, from: string, to: string): Promise<{ synced: number }> {
  const account = await getAccountRow(accountId);
  if (!account) throw new Error(`Unknown Fold account id: ${accountId}`);

  return withTempConfig(accountId, async (tmpConfigPath) => {
    const tmpDbPath = path.join(os.tmpdir(), `unfold-${accountId}-${crypto.randomUUID()}.sqlite`);
    try {
      const { code, stderr } = await runCli(
        ["transactions", "-d", "--db-path", tmpDbPath, "--config", tmpConfigPath, "--since", from, "--till", to],
        120_000
      );
      if (code !== 0) throw new Error(`Sync failed for ${account.label} (${from} → ${to}): ${scrubSecrets(stderr.trim()) || "unknown error"}`);
      if (!fs.existsSync(tmpDbPath)) return { synced: 0 };
      fs.chmodSync(tmpDbPath, 0o600); // close the window before we read transaction data out of it

      const buf = fs.readFileSync(tmpDbPath);
      const localDb = await loadSqlJsDatabase(buf);
      const rows: any[] = [];
      try {
        const stmt = localDb.prepare(`SELECT * FROM transactions`);
        while (stmt.step()) rows.push(stmt.getAsObject());
        stmt.free();
      } finally {
        localDb.close();
      }

      for (let i = 0; i < rows.length; i += BATCH_SIZE) {
        const chunk = rows.slice(i, i + BATCH_SIZE);
        const stmts = chunk.map((r) => ({
          sql: UPSERT_SQL,
          args: [accountId, ...TX_COLUMNS.map((c) => r[c] ?? null)],
        }));
        await getTurso().batch(stmts, "write");
      }

      invalidateFtsCache(accountId);
      await getTurso().execute({
        sql: `UPDATE fold_accounts SET last_synced_at = datetime('now') WHERE id = ?`,
        args: [accountId],
      });

      return { synced: rows.length };
    } finally {
      fs.rmSync(tmpDbPath, { force: true });
    }
  });
}

// ─── Investments (mutual funds / stocks / EPF / NPS / PPF / FDs) ─────────────
// Unlike transactions, investment data is a current-state snapshot, not a growing
// ledger — so there's no DB sync step, just a live fetch per call via the CLI's
// `investments --json` bridge (see unfold_cli/cmd/investments.go).
export async function getInvestments(accountId: string): Promise<InvestmentsData> {
  const account = await getAccountRow(accountId);
  if (!account) throw new Error(`Unknown Fold account id: ${accountId}`);

  return withTempConfig(accountId, async (tmpConfigPath) => {
    const { code, stdout, stderr } = await runCli(
      ["investments", "--json", "--config", tmpConfigPath],
      60_000
    );
    if (code !== 0) {
      throw new Error(`Failed to fetch investments for ${account.label}: ${scrubSecrets(stderr.trim()) || "unknown error"}`);
    }
    try {
      return JSON.parse(stdout.trim());
    } catch {
      throw new Error(`Failed to parse investments output: ${stdout.slice(0, 200)}`);
    }
  });
}
