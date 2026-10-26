// Database access for accounts and balances.
//
// Production (Vercel): set DATABASE_URL to the Neon Postgres connection string.
// Local preview: no DATABASE_URL needed — an embedded Postgres (PGlite) stores
// data in .local-data/pglite so you can test without any cloud setup.
//
// Every balance change is a single SQL statement, so it is atomic on both
// drivers without needing interactive transactions.

import { CHANNEL_SCHEMA } from "./channels.js";
import { ALERT_SCHEMA } from "./alerts.js";
import { TASK_SCHEMA } from "./tasks.js";
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
    user_id     BIGINT NOT NULL REFERENCES lw_users(id) ON DELETE CASCADE ON UPDATE CASCADE,
    expires_at  TIMESTAMPTZ NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lw_sessions_user ON lw_sessions(user_id);
CREATE TABLE IF NOT EXISTS lw_device_tokens (
    token_hash  TEXT PRIMARY KEY,
    user_id     BIGINT NOT NULL REFERENCES lw_users(id) ON DELETE CASCADE ON UPDATE CASCADE,
    expires_at  TIMESTAMPTZ NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lw_device_tokens_user ON lw_device_tokens(user_id);
ALTER TABLE lw_users ADD COLUMN IF NOT EXISTS display_name TEXT NOT NULL DEFAULT '';
ALTER TABLE lw_users ADD COLUMN IF NOT EXISTS avatar TEXT NOT NULL DEFAULT '';
CREATE TABLE IF NOT EXISTS lw_ledger (
    id            BIGSERIAL PRIMARY KEY,
    user_id       BIGINT NOT NULL REFERENCES lw_users(id) ON DELETE CASCADE ON UPDATE CASCADE,
    delta_milli   BIGINT NOT NULL,
    balance_after BIGINT NOT NULL,
    kind          TEXT NOT NULL,
    note          TEXT NOT NULL DEFAULT '',
    ref           TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lw_ledger_user ON lw_ledger(user_id, id DESC);
-- One row per refunded 土豆 direct charge: the primary key makes "refund once" atomic.
CREATE TABLE IF NOT EXISTS lw_direct_refunds (
    ref        TEXT PRIMARY KEY,
    user_id    BIGINT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS lw_codes (
    code         TEXT PRIMARY KEY,
    amount_milli BIGINT NOT NULL CHECK (amount_milli > 0),
    batch        TEXT NOT NULL DEFAULT '',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    used_by      BIGINT REFERENCES lw_users(id) ON DELETE SET NULL ON UPDATE CASCADE,
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

// Self-hosted Postgres (the Hong Kong server) uses the regular pg driver.
async function openPg(url) {
    const { default: pg } = await import("pg");
    const pool = new pg.Pool({ connectionString: url, max: 10 });
    return {
        kind: "pg",
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
        ? (process.env.LW_DB_DRIVER === "pg" || !/neon\.tech/i.test(url) ? await openPg(url) : await openNeon(url))
        : await openPglite(options.dataDir ?? process.env.LW_LOCAL_DB_DIR ?? ".local-data/pglite");
    await db.exec(SCHEMA);
    await db.exec(CHANNEL_SCHEMA);
    await db.exec(VERIFY_SCHEMA);
    await db.exec(TASK_SCHEMA);
    await db.exec(ALERT_SCHEMA);
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
