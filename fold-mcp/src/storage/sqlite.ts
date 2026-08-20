import initSqlJs from "sql.js";
import type { Database, SqlJsStatic } from "sql.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

/**
 * Local, zero-config storage backend — a straight port of what local-mcp's
 * index.ts did inline (sql.js/WASM sqlite, no native compilation, no cloud
 * account of any kind). There's exactly one implicit Fold account, so unlike
 * turso.ts there's no per-account scoping to do: `runQuery` executes the SQL
 * as-is against the one local `db.sqlite` file.
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// storage/sqlite.js -> build/storage -> build -> fold-mcp -> repo root
const dbPath = path.resolve(__dirname, "..", "..", "..", "db.sqlite");

let SQL: SqlJsStatic | undefined;
let db: Database | undefined;
let ftsDb: Database | undefined;
let dbLoadedAt = 0;

async function ensureSqlJs(): Promise<SqlJsStatic> {
  if (!SQL) SQL = await initSqlJs();
  return SQL;
}

function loadDbFromDisk(sqlJs: SqlJsStatic): Database {
  try {
    const buf = fs.readFileSync(dbPath);
    dbLoadedAt = fs.statSync(dbPath).mtimeMs;
    return new sqlJs.Database(buf);
  } catch {
    // Pre-first-sync: no db.sqlite yet.
    dbLoadedAt = 0;
    return new sqlJs.Database();
  }
}

async function reloadDbFromDisk(): Promise<void> {
  const sqlJs = await ensureSqlJs();
  db?.close();
  db = loadDbFromDisk(sqlJs);
  await rebuildFtsIfStale();
}

/**
 * Cheap mtime check before every read — closes the class of bug where
 * local-mcp's original design only refreshed on an explicit get_sync_status
 * call, so full_text_search (and everything else) could silently serve stale
 * data until the user happened to check sync status first.
 */
async function reloadDbIfStale(): Promise<void> {
  try {
    const mtime = fs.statSync(dbPath).mtimeMs;
    if (mtime > dbLoadedAt) await reloadDbFromDisk();
  } catch {
    // db.sqlite doesn't exist yet — nothing to reload.
  }
}

export async function init(): Promise<void> {
  const sqlJs = await ensureSqlJs();
  db = loadDbFromDisk(sqlJs);
  ftsDb = new sqlJs.Database();
  await initFts();
}

function requireDb(): Database {
  if (!db) throw new Error("Internal error: sqlite storage used before init()");
  return db;
}

function requireFtsDb(): Database {
  if (!ftsDb) throw new Error("Internal error: sqlite storage used before init()");
  return ftsDb;
}

export async function runQuery<T>(sql: string, params: any[] = []): Promise<T[]> {
  await reloadDbIfStale();
  const stmt = requireDb().prepare(sql);
  stmt.bind(params);
  const rows: T[] = [];
  while (stmt.step()) rows.push(stmt.getAsObject() as T);
  stmt.free();
  return rows;
}

/** Single-account mode has nothing to scope — paramsFactory's "account id" argument is a fixed placeholder. */
export async function runQueryManual<T>(
  sql: string,
  paramsFactory: (foldAccountId: string) => any[]
): Promise<T[]> {
  return runQuery<T>(sql, paramsFactory("local"));
}

export async function runFtsQuery<T>(query: string, params: any[] = []): Promise<T[]> {
  await reloadDbIfStale();
  const stmt = requireFtsDb().prepare(query);
  stmt.bind(params);
  const rows: T[] = [];
  while (stmt.step()) rows.push(stmt.getAsObject() as T);
  stmt.free();
  return rows;
}

async function initFts(): Promise<void> {
  requireFtsDb().exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS tx_fts USING fts4(
      uuid, merchant, narration, summary,
      notindexed=uuid,
      tokenize=porter
    )
  `);
  await rebuildFtsIfStale();
}

export async function rebuildFtsIfStale(): Promise<void> {
  const [tableCheck] = await rawQuery<any>(
    `SELECT name FROM sqlite_master WHERE type='table' AND name='transactions'`
  );
  if (!tableCheck) return; // pre-first-sync

  const [ftsRow] = await rawFtsQuery<any>(`SELECT COUNT(*) as cnt FROM tx_fts`);
  const [mainRow] = await rawQuery<any>(`SELECT COUNT(*) as cnt FROM transactions`);
  if ((ftsRow?.cnt ?? 0) >= (mainRow?.cnt ?? 0)) return;

  const rows = await rawQuery<any>(
    `SELECT uuid, COALESCE(merchant,'') as merchant,
            COALESCE(narration,'') as narration,
            COALESCE(summary,'') as summary
     FROM transactions`
  );

  const ftsDbInst = requireFtsDb();
  ftsDbInst.exec("DELETE FROM tx_fts");
  ftsDbInst.exec("BEGIN");
  const stmt = ftsDbInst.prepare(`INSERT INTO tx_fts(uuid, merchant, narration, summary) VALUES (?,?,?,?)`);
  for (const r of rows) stmt.run([r.uuid, r.merchant, r.narration, r.summary]);
  stmt.free();
  ftsDbInst.exec("COMMIT");
}

// rebuildFtsIfStale's own reads must NOT go through runQuery/runFtsQuery (which would
// recurse back into reloadDbIfStale -> rebuildFtsIfStale) — these bypass the staleness
// check since the caller (reloadDbFromDisk/initFts) has already just loaded fresh data.
function rawQuery<T>(sql: string, params: any[] = []): Promise<T[]> {
  const stmt = requireDb().prepare(sql);
  stmt.bind(params);
  const rows: T[] = [];
  while (stmt.step()) rows.push(stmt.getAsObject() as T);
  stmt.free();
  return Promise.resolve(rows);
}

function rawFtsQuery<T>(query: string, params: any[] = []): Promise<T[]> {
  const stmt = requireFtsDb().prepare(query);
  stmt.bind(params);
  const rows: T[] = [];
  while (stmt.step()) rows.push(stmt.getAsObject() as T);
  stmt.free();
  return Promise.resolve(rows);
}

// ─── withAccount/currentFoldAccountId stand-ins ──────────────────────────────
// Single implicit account — these exist only so index.ts's `withAccount(id, fn)`
// wrapper around every tool call works unmodified regardless of which backend is
// active. See storage/types.ts for why this isn't part of the shared interface.
export function currentFoldAccountId(): string {
  return "local";
}

export function withAccount<T>(_foldAccountId: string, fn: () => Promise<T>): Promise<T> {
  return fn();
}
