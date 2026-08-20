import * as turso from "./turso.js";
import * as sqlite from "./sqlite.js";

/**
 * Backend is auto-detected, not a separate flag to remember: if Turso
 * credentials are present, use them (unlocking multi-account + optional
 * HTTP/Render); otherwise default to the zero-config local sqlite backend.
 * This is the whole "ease of setup" story — a fresh clone with no .env at
 * all just works, fully locally, with no decision to make.
 */
export type Backend = "sqlite" | "turso";
export const backend: Backend = process.env.TURSO_DATABASE_URL ? "turso" : "sqlite";

const impl = backend === "turso" ? turso : sqlite;

export const init = impl.init;
export const runQuery = impl.runQuery;
export const runQueryManual = impl.runQueryManual;
export const runFtsQuery = impl.runFtsQuery;
export const rebuildFtsIfStale = impl.rebuildFtsIfStale;
export const withAccount = impl.withAccount;
export const currentFoldAccountId = impl.currentFoldAccountId;
