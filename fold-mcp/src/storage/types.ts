/**
 * The query surface every tool handler in index.ts is written against — both
 * backends (turso.ts, sqlite.ts) implement these same exported functions with
 * the same signatures, so index.ts's ~34 tool handlers don't know or care
 * which one is active.
 *
 * Deliberately NOT a TypeScript `interface`/class hierarchy: each backend
 * exports plain top-level functions (matching the pattern already used by
 * today's db.ts) and storage/index.ts re-exports whichever module's
 * functions apply, picked once at startup. This keeps the call sites in
 * index.ts unchanged (`import { runQuery, ... } from "./storage/index.js"`)
 * without the indirection of an object/class the whole file would have to
 * thread through.
 *
 * Account-scoping (withAccount/currentFoldAccountId) is NOT part of this
 * contract — it's a turso.ts-internal mechanism for isolating multiple
 * linked accounts sharing one physical table (see scopeSql in turso.ts).
 * sqlite.ts has exactly one implicit account and needs no equivalent; its
 * withAccount/currentFoldAccountId are provided as no-op-shaped stand-ins
 * (see sqlite.ts) purely so index.ts's `withAccount(id, fn)` wrapper around
 * every tool call doesn't need a backend-conditional in index.ts itself.
 */
export interface TransactionStore {
  /** One-time setup — load db.sqlite / lazily prep the Turso client. Safe to call multiple times. */
  init(): Promise<void>;

  /** Run a query already scoped to "the current account" however this backend defines that. */
  runQuery<T>(sql: string, params?: any[]): Promise<T[]>;

  /** For queries that can't be auto-scoped (aliased/joined) — caller scopes explicitly. */
  runQueryManual<T>(sql: string, paramsFactory: (foldAccountId: string) => any[]): Promise<T[]>;

  /** Query the derived full-text-search index. */
  runFtsQuery<T>(query: string, params?: any[]): Promise<T[]>;

  /** Rebuild the FTS index from the source of truth if it's behind. Cheap to call before every search. */
  rebuildFtsIfStale(): Promise<void>;
}
