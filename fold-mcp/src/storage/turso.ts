import { createClient, type Client } from "@libsql/client";
import { AsyncLocalStorage } from "node:async_hooks";
import initSqlJs from "sql.js";
import type { Database, SqlJsStatic } from "sql.js";
import { config } from "../config.js";

/**
 * Turso (libSQL) is the single source of truth for transaction data and
 * account metadata — it replaces the old local db.sqlite file so the same
 * data is reachable whether the server is running over stdio on a laptop or
 * over HTTP on a remote host. The 22 existing tool handlers in index.ts were
 * NOT rewritten query-by-query: every one of them still calls runQuery(sql,
 * params) with the exact same SQL strings as before. Two things make that
 * possible:
 *
 *  1. libSQL is wire-compatible with SQLite, so the query text itself barely
 *     changed (see scopeSql below for the one exception).
 *  2. "Which Fold account is this call for" is carried via AsyncLocalStorage
 *     rather than threaded through every function signature — index.ts wraps
 *     each tool call once in withAccount(id, ...) and every runQuery() call
 *     inside that scope automatically reads it back out.
 */

let turso: Client | undefined;
export function getTurso(): Client {
  if (!turso) {
    turso = createClient({ url: config.tursoUrl, authToken: config.tursoAuthToken });
  }
  return turso;
}

/** No-op — the Turso client connects lazily on first getTurso() call. Exists so
 * storage/index.ts can call init() uniformly regardless of which backend is active. */
export async function init(): Promise<void> {}

// ─── Per-call "which Fold account" context ───────────────────────────────────
const accountStorage = new AsyncLocalStorage<string>();

export function currentFoldAccountId(): string {
  const id = accountStorage.getStore();
  if (!id) {
    throw new Error(
      "Internal error: no active Fold account in context. Every tool call must resolve " +
      "an account (via accounts.resolveAccountId) before touching the database."
    );
  }
  return id;
}

export function withAccount<T>(foldAccountId: string, fn: () => Promise<T>): Promise<T> {
  return accountStorage.run(foldAccountId, fn);
}

// ─── Query execution ──────────────────────────────────────────────────────────
async function execute<T>(sql: string, args: any[]): Promise<T[]> {
  const result = await getTurso().execute({ sql, args });
  return result.rows.map((row) => {
    const obj: any = {};
    result.columns.forEach((col, i) => { obj[col] = (row as any)[i]; });
    return obj as T;
  });
}

const SCOPE_COLUMN = "fold_account_id";
const CLAUSE_KEYWORDS = new Set([
  "WHERE", "GROUP", "ORDER", "LIMIT", "HAVING", "JOIN", "INNER", "LEFT", "RIGHT", "OUTER", "ON", "UNION",
]);

/**
 * Every query in this codebase does `... FROM transactions [WHERE ...]` with
 * no table alias, EXCEPT two (the merchant-average comparison queries in
 * get_weekly_digest and get_unusual_transactions) which alias it as `t` and
 * join a `transactions`-derived subquery. Auto-scoping can't safely rewrite
 * an aliased/joined query by string surgery — those two call runQueryManual
 * instead and scope themselves explicitly. This function refuses (throws)
 * rather than silently mis-scoping if it ever encounters an alias it wasn't
 * written to handle, so a future query gets a loud failure instead of quietly
 * mixing data across accounts.
 */
function scopeSql(sql: string, foldAccountId: string, params: any[]): { sql: string; args: any[] } {
  const marker = "FROM transactions";
  const injections: { offset: number; text: string }[] = [];
  let searchFrom = 0;

  while (true) {
    const idx = sql.indexOf(marker, searchFrom);
    if (idx === -1) break;
    const afterIdx = idx + marker.length;
    const after = sql.slice(afterIdx);

    const wordMatch = /^\s+([A-Za-z_][A-Za-z0-9_]*)\b/.exec(after);
    if (wordMatch && !CLAUSE_KEYWORDS.has(wordMatch[1].toUpperCase())) {
      throw new Error(
        `runQuery: "FROM transactions ${wordMatch[1]}" uses a table alias — auto-scoping doesn't ` +
        `handle aliased/joined queries safely. Use runQueryManual and scope it explicitly instead.`
      );
    }

    const whereMatch = /^\s*WHERE\b/i.exec(after);
    if (whereMatch) {
      injections.push({ offset: afterIdx + whereMatch[0].length, text: ` ${SCOPE_COLUMN} = ? AND` });
    } else {
      injections.push({ offset: afterIdx, text: ` WHERE ${SCOPE_COLUMN} = ?` });
    }
    searchFrom = afterIdx;
  }

  if (injections.length === 0) return { sql, args: params };

  const byOffset = new Map<number, string>();
  for (const inj of injections) byOffset.set(inj.offset, inj.text);

  let out = "";
  const args: any[] = [];
  let paramIdx = 0;
  for (let i = 0; i <= sql.length; i++) {
    const injText = byOffset.get(i);
    if (injText !== undefined) {
      out += injText;
      args.push(foldAccountId);
    }
    if (i < sql.length) {
      const ch = sql[i];
      if (ch === "?") args.push(params[paramIdx++]);
      out += ch;
    }
  }
  return { sql: out, args };
}

/** Drop-in replacement for the old sql.js-backed runQuery — same signature, same SQL strings. */
export async function runQuery<T>(sql: string, params: any[] = []): Promise<T[]> {
  const foldAccountId = currentFoldAccountId();
  const { sql: scopedSql, args } = scopeSql(sql, foldAccountId, params);
  return execute<T>(scopedSql, args);
}

/**
 * For the two queries that alias `transactions` and join a subquery derived
 * from it. The caller writes `fold_account_id = ?` (and, for the aliased
 * table, `t.fold_account_id = ?`) explicitly in the SQL, and paramsFactory
 * returns the full, correctly-ordered args array given the resolved account id.
 */
export async function runQueryManual<T>(
  sql: string,
  paramsFactory: (foldAccountId: string) => any[]
): Promise<T[]> {
  const foldAccountId = currentFoldAccountId();
  return execute<T>(sql, paramsFactory(foldAccountId));
}

// ─── Per-account full-text-search index (sql.js, in-memory, ephemeral cache) ─
// This is purely a derived cache over Turso's transactions table — never a
// source of truth — so keeping one per linked account (rather than one
// shared global, as the old local-file version had) just means each
// account's search results are limited to its own transactions, matching
// the same isolation runQuery already enforces on the way out.
let SQL: SqlJsStatic | undefined;
const ftsDbs = new Map<string, Database>();

async function ensureSqlJs(): Promise<SqlJsStatic> {
  if (!SQL) SQL = await initSqlJs();
  return SQL;
}

/** Shared with accounts.ts, which reads a freshly-synced local sqlite file into memory. */
export async function loadSqlJsDatabase(buf: Buffer): Promise<Database> {
  const sqlJs = await ensureSqlJs();
  return new sqlJs.Database(buf);
}

async function getFtsDb(foldAccountId: string): Promise<Database> {
  let d = ftsDbs.get(foldAccountId);
  if (!d) {
    const sqlJs = await ensureSqlJs();
    d = new sqlJs.Database();
    d.exec(
      `CREATE VIRTUAL TABLE IF NOT EXISTS tx_fts USING fts4(
         uuid, merchant, narration, summary,
         notindexed=uuid,
         tokenize=porter
       )`
    );
    ftsDbs.set(foldAccountId, d);
  }
  return d;
}

export async function runFtsQuery<T>(query: string, params: any[] = []): Promise<T[]> {
  const d = await getFtsDb(currentFoldAccountId());
  const stmt = d.prepare(query);
  stmt.bind(params);
  const rows: T[] = [];
  while (stmt.step()) rows.push(stmt.getAsObject() as T);
  stmt.free();
  return rows;
}

/** Rebuilds the current account's FTS index from Turso if it's behind the row count. */
export async function rebuildFtsIfStale(): Promise<void> {
  const foldAccountId = currentFoldAccountId();
  const ftsDbInst = await getFtsDb(foldAccountId);

  const [mainRow] = await runQuery<any>(`SELECT COUNT(*) as cnt FROM transactions`);
  const ftsStmt = ftsDbInst.prepare(`SELECT COUNT(*) as cnt FROM tx_fts`);
  ftsStmt.step();
  const ftsCnt = (ftsStmt.getAsObject() as any).cnt ?? 0;
  ftsStmt.free();

  if (ftsCnt >= (mainRow?.cnt ?? 0)) return;

  const rows = await runQuery<any>(
    `SELECT uuid, COALESCE(merchant,'') as merchant,
            COALESCE(narration,'') as narration,
            COALESCE(summary,'') as summary
     FROM transactions`
  );

  ftsDbInst.exec("DELETE FROM tx_fts");
  ftsDbInst.exec("BEGIN");
  const stmt = ftsDbInst.prepare(
    `INSERT INTO tx_fts(uuid, merchant, narration, summary) VALUES (?,?,?,?)`
  );
  for (const r of rows) stmt.run([r.uuid, r.merchant, r.narration, r.summary]);
  stmt.free();
  ftsDbInst.exec("COMMIT");
}

/** Invalidates a stale FTS cache after a sync writes new rows for this account. */
export function invalidateFtsCache(foldAccountId: string): void {
  const d = ftsDbs.get(foldAccountId);
  if (d) { d.close(); ftsDbs.delete(foldAccountId); }
}
