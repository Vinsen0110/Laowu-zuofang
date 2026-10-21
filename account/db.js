// Database access for accounts and balances.
//
// Production (Vercel): set DATABASE_URL to the Neon Postgres connection string.
// Local preview: no DATABASE_URL needed — an embedded Postgres (PGlite) stores
// data in .local-data/pglite so you can test without any cloud setup.
//
// Every balance change is a single SQL statement, so it is atomic on both
// drivers without needing interactive transactions.

import { CHANNEL_SCHEMA } from "./channels.js";
import { VERIFY_SCHEMA } from "./verify.js";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS lw_users (
    id            BIGSERIAL PRIMARY KEY,
    username      TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL DEFAULT 'user',
    balance_milli BIGINT NOT NULL DEFAULT 0 CHECK (balance_milli >= 0),
    disabled      BOOLEAN NOT NULL DEFAULT FALSE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS lw_sessions (
    token_hash  TEXT PRIMARY KEY,
    user_id     BIGINT NOT NULL REFERENCES lw_users(id) ON DELETE CASCADE,
    expires_at  TIMESTAMPTZ NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lw_sessions_user ON lw_sessions(user_id);
CREATE TABLE IF NOT EXISTS lw_ledger (
    id            BIGSERIAL PRIMARY KEY,
    user_id       BIGINT NOT NULL REFERENCES lw_users(id) ON DELETE CASCADE,
    delta_milli   BIGINT NOT NULL,
    balance_after BIGINT NOT NULL,
    kind          TEXT NOT NULL,
    note          TEXT NOT NULL DEFAULT '',
    ref           TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lw_ledger_user ON lw_ledger(user_id, id DESC);
CREATE TABLE IF NOT EXISTS lw_codes (
    code         TEXT PRIMARY KEY,
    amount_milli BIGINT NOT NULL CHECK (amount_milli > 0),
    batch        TEXT NOT NULL DEFAULT '',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    used_by      BIGINT REFERENCES lw_users(id) ON DELETE SET NULL,
    used_at      TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS lw_codes_batch ON lw_codes(batch);
CREATE TABLE IF NOT EXISTS lw_login_attempts (
    key         TEXT PRIMARY KEY,
    failures    INTEGER NOT NULL DEFAULT 0,
    locked_until TIMESTAMPTZ
);
`;

let dbPromise = null;

async function openNeon(url) {
    const { Pool } = await import("@neondatabase/serverless");
    const pool = new Pool({ connectionString: url });
    return {
        kind: "neon",
        async query(text, params = []) {
            const result = await pool.query(text, params);
            return result.rows;
        },
        async exec(text) {
            await pool.query(text);
        },
        async close() {
            await pool.end();
        },
    };
}

async function openPglite(dataDir) {
    const { PGlite } = await import("@electric-sql/pglite");
    if (dataDir) {
        const { mkdirSync } = await import("node:fs");
        mkdirSync(dataDir, { recursive: true });
    }
    const db = dataDir ? new PGlite(dataDir) : new PGlite();
    await db.waitReady;
    return {
        kind: "pglite",
        async query(text, params = []) {
            const result = await db.query(text, params);
            return result.rows;
        },
        async exec(text) {
            await db.exec(text);
        },
        async close() {
            await db.close();
        },
    };
}

export async function openDatabase(options = {}) {
    const url = options.url ?? process.env.DATABASE_URL;
    const db = url
        ? await openNeon(url)
        : await openPglite(options.dataDir ?? process.env.LW_LOCAL_DB_DIR ?? ".local-data/pglite");
    await db.exec(SCHEMA);
    await db.exec(CHANNEL_SCHEMA);
    await db.exec(VERIFY_SCHEMA);
    return db;
}

export function getDatabase() {
    if (!dbPromise) {
        dbPromise = openDatabase().catch((error) => {
            dbPromise = null;
            throw error;
        });
    }
    return dbPromise;
}

// For tests: use an in-memory database.
export async function openMemoryDatabase() {
    return openDatabase({ url: "", dataDir: "" });
}
