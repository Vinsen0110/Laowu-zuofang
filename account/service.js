// Account business logic: users, sessions, balances, redeem codes.
// Money is stored as integer "milli-yuan" (1 元 = 1000) to avoid float errors.

import { createHash, randomBytes, randomInt, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb);

export const SESSION_DAYS = 30;
const MAX_LOGIN_FAILURES = 8;
const LOCK_MINUTES = 15;
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I

export class AccountError extends Error {
    constructor(status, code, message) {
        super(message);
        this.status = status;
        this.code = code;
    }
}

// ---------- money helpers ----------
export function yuanToMilli(value) {
    const n = typeof value === "string" ? Number(value.trim()) : Number(value);
    if (!Number.isFinite(n)) throw new AccountError(400, "bad_amount", "金额格式不正确");
    return Math.round(n * 1000);
}

export function milliToYuan(milli) {
    return Number(milli) / 1000;
}

// ---------- validation ----------
// Accounts are identified by email (stored in the "username" column).
export function normalizeEmail(raw) {
    const email = String(raw ?? "").trim().toLowerCase();
    if (email.length > 120 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
        throw new AccountError(400, "bad_email", "请输入正确的邮箱地址");
    }
    return email;
}

export function checkPassword(raw) {
    const pw = String(raw ?? "");
    if (pw.length < 8 || pw.length > 72) {
        throw new AccountError(400, "bad_password", "密码需为 8–72 位");
    }
    return pw;
}

// ---------- password hashing ----------
export async function hashPassword(password) {
    const salt = randomBytes(16);
    const key = await scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 });
    return `scrypt$${salt.toString("base64")}$${Buffer.from(key).toString("base64")}`;
}

export async function verifyPassword(password, stored) {
    const [scheme, saltB64, keyB64] = String(stored || "").split("$");
    if (scheme !== "scrypt" || !saltB64 || !keyB64) return false;
    const expected = Buffer.from(keyB64, "base64");
    const actual = Buffer.from(await scrypt(password, Buffer.from(saltB64, "base64"), expected.length, { N: 16384, r: 8, p: 1 }));
    return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function sha256(value) {
    return createHash("sha256").update(value).digest("hex");
}

function adminNames() {
    return String(process.env.LW_ADMIN_EMAILS || process.env.LW_ADMIN_USERNAMES || "")
        .split(/[,\s]+/)
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
}

function publicUser(row) {
    if (!row) return null;
    return {
        id: Number(row.id),
        email: row.username,
        emailVerified: Boolean(row.email_verified),
        username: row.username,
        displayName: String(row.username).split("@")[0],
        role: row.role,
        balance: milliToYuan(row.balance_milli),
        balanceMilli: Number(row.balance_milli),
        disabled: Boolean(row.disabled),
        createdAt: row.created_at,
    };
}

// ---------- users & sessions ----------
export async function register(db, { email, username, password }) {
    const name = normalizeEmail(email ?? username);
    const pw = checkPassword(password);
    const existing = await db.query("SELECT 1 FROM lw_users WHERE lower(username) = lower($1)", [name]);
    if (existing.length) throw new AccountError(409, "email_taken", "这个邮箱已经注册过了，请直接登录");
    const role = adminNames().includes(name.toLowerCase()) ? "admin" : "user";
    const hash = await hashPassword(pw);
    try {
        const rows = await db.query(
            "INSERT INTO lw_users (username, password_hash, role) VALUES ($1, $2, $3) RETURNING *",
            [name, hash, role],
        );
        return publicUser(rows[0]);
    } catch (error) {
        if (String(error?.message || "").includes("unique")) {
            throw new AccountError(409, "email_taken", "这个邮箱已经注册过了，请直接登录");
        }
        throw error;
    }
}

async function checkLock(db, key) {
    const rows = await db.query("SELECT failures, locked_until FROM lw_login_attempts WHERE key = $1", [key]);
    const row = rows[0];
    if (row?.locked_until && new Date(row.locked_until) > new Date()) {
        throw new AccountError(429, "locked", `尝试次数过多，请 ${LOCK_MINUTES} 分钟后再试`);
    }
}

async function recordFailure(db, key) {
    await db.query(
        `INSERT INTO lw_login_attempts (key, failures) VALUES ($1, 1)
         ON CONFLICT (key) DO UPDATE SET
           failures = CASE WHEN lw_login_attempts.locked_until IS NOT NULL AND lw_login_attempts.locked_until < now() THEN 1 ELSE lw_login_attempts.failures + 1 END,
           locked_until = CASE
             WHEN (CASE WHEN lw_login_attempts.locked_until IS NOT NULL AND lw_login_attempts.locked_until < now() THEN 1 ELSE lw_login_attempts.failures + 1 END) >= $2
             THEN now() + make_interval(mins => $3) ELSE NULL END`,
        [key, MAX_LOGIN_FAILURES, LOCK_MINUTES],
    );
}

export async function login(db, { email, username, password }) {
    const name = String(email ?? username ?? "").trim().toLowerCase();
    const key = `login:${name.toLowerCase()}`;
    await checkLock(db, key);
    const rows = await db.query("SELECT * FROM lw_users WHERE lower(username) = lower($1)", [name]);
    const user = rows[0];
    const ok = user ? await verifyPassword(String(password ?? ""), user.password_hash) : false;
    if (!ok) {
        await recordFailure(db, key);
        throw new AccountError(401, "bad_credentials", "邮箱或密码不正确");
    }
    if (user.disabled) throw new AccountError(403, "disabled", "该账号已被停用，请联系管理员");
    await db.query("DELETE FROM lw_login_attempts WHERE key = $1", [key]);
    const token = randomBytes(32).toString("base64url");
    await db.query(
        "INSERT INTO lw_sessions (token_hash, user_id, expires_at) VALUES ($1, $2, now() + make_interval(days => $3))",
        [sha256(token), user.id, SESSION_DAYS],
    );
    return { token, user: publicUser(user) };
}

export async function logout(db, token) {
    if (!token) return;
    await db.query("DELETE FROM lw_sessions WHERE token_hash = $1", [sha256(token)]);
}

export async function userFromSession(db, token) {
    if (!token) return null;
    const rows = await db.query(
        `SELECT u.* FROM lw_sessions s JOIN lw_users u ON u.id = s.user_id
         WHERE s.token_hash = $1 AND s.expires_at > now()`,
        [sha256(token)],
    );
    const user = rows[0];
    if (!user || user.disabled) return null;
    // LW_ADMIN_EMAILS is the source of truth, so an existing account becomes
    // admin as soon as its email is added there.
    if (user.role !== "admin" && adminNames().includes(String(user.username).toLowerCase())) {
        await db.query("UPDATE lw_users SET role = 'admin' WHERE id = $1", [user.id]);
        user.role = "admin";
    }
    return publicUser(user);
}

export async function changePassword(db, userId, { oldPassword, newPassword }) {
    const rows = await db.query("SELECT password_hash FROM lw_users WHERE id = $1", [userId]);
    if (!rows[0] || !(await verifyPassword(String(oldPassword ?? ""), rows[0].password_hash))) {
        throw new AccountError(401, "bad_credentials", "原密码不正确");
    }
    const hash = await hashPassword(checkPassword(newPassword));
    await db.query("UPDATE lw_users SET password_hash = $1 WHERE id = $2", [hash, userId]);
    await db.query("DELETE FROM lw_sessions WHERE user_id = $1", [userId]);
}

// ---------- balance ----------
// Atomically change a balance and write the ledger row. Fails (returns null)
// when a debit would make the balance negative.
export async function adjustBalance(db, userId, deltaMilli, { kind, note = "", ref = null }) {
    const delta = Math.trunc(Number(deltaMilli));
    if (!Number.isFinite(delta) || delta === 0) throw new AccountError(400, "bad_amount", "金额不能为 0");
    const rows = await db.query(
        `WITH u AS (
            UPDATE lw_users SET balance_milli = balance_milli + $2
            WHERE id = $1 AND balance_milli + $2 >= 0
            RETURNING id, balance_milli
         ), l AS (
            INSERT INTO lw_ledger (user_id, delta_milli, balance_after, kind, note, ref)
            SELECT id, $2, balance_milli, $3, $4, $5 FROM u
            RETURNING id
         )
         SELECT u.balance_milli FROM u`,
        [userId, delta, kind, String(note).slice(0, 200), ref],
    );
    if (!rows[0]) return null;
    return Number(rows[0].balance_milli);
}

export async function ledger(db, userId, limit = 30) {
    const rows = await db.query(
        `SELECT id, delta_milli, balance_after, kind, note, created_at
         FROM lw_ledger WHERE user_id = $1 ORDER BY id DESC LIMIT $2`,
        [userId, Math.min(Math.max(Number(limit) || 30, 1), 200)],
    );
    return rows.map((r) => ({
        id: Number(r.id),
        amount: milliToYuan(r.delta_milli),
        balanceAfter: milliToYuan(r.balance_after),
        kind: r.kind,
        note: r.note,
        createdAt: r.created_at,
    }));
}

// ---------- redeem codes ----------
function newCode() {
    let s = "";
    for (let i = 0; i < 16; i++) s += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
    return `LW-${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}`;
}

export function normalizeCode(raw) {
    const compact = String(raw ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    const body = compact.startsWith("LW") ? compact.slice(2) : compact;
    if (body.length !== 16) return null;
    return `LW-${body.slice(0, 4)}-${body.slice(4, 8)}-${body.slice(8, 12)}-${body.slice(12, 16)}`;
}

export async function createCodes(db, { count, amountYuan, batch = "" }) {
    const n = Math.trunc(Number(count));
    if (!(n >= 1 && n <= 500)) throw new AccountError(400, "bad_count", "一次可生成 1–500 个");
    const amount = yuanToMilli(amountYuan);
    if (amount <= 0) throw new AccountError(400, "bad_amount", "面额必须大于 0");
    const label = String(batch || new Date().toISOString().slice(0, 16).replace("T", " ")).slice(0, 60);
    const codes = [];
    while (codes.length < n) {
        const code = newCode();
        const rows = await db.query(
            "INSERT INTO lw_codes (code, amount_milli, batch) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING code",
            [code, amount, label],
        );
        if (rows[0]) codes.push(code);
    }
    return { batch: label, amount: milliToYuan(amount), codes };
}

export async function redeemCode(db, userId, rawCode) {
    const code = normalizeCode(rawCode);
    if (!code) throw new AccountError(400, "bad_code", "兑换码格式不正确");
    const rows = await db.query(
        `WITH c AS (
            UPDATE lw_codes SET used_by = $1, used_at = now()
            WHERE code = $2 AND used_by IS NULL
            RETURNING code, amount_milli
         ), u AS (
            UPDATE lw_users SET balance_milli = balance_milli + (SELECT amount_milli FROM c)
            WHERE id = $1 AND EXISTS (SELECT 1 FROM c)
            RETURNING id, balance_milli
         ), l AS (
            INSERT INTO lw_ledger (user_id, delta_milli, balance_after, kind, note, ref)
            SELECT u.id, c.amount_milli, u.balance_milli, 'redeem', '兑换码充值', c.code FROM u, c
            RETURNING id
         )
         SELECT c.amount_milli, u.balance_milli FROM c, u`,
        [userId, code],
    );
    if (!rows[0]) {
        const exists = await db.query("SELECT used_by FROM lw_codes WHERE code = $1", [code]);
        if (!exists[0]) throw new AccountError(404, "code_not_found", "兑换码不存在");
        throw new AccountError(409, "code_used", "这个兑换码已经被使用过了");
    }
    return { amount: milliToYuan(rows[0].amount_milli), balance: milliToYuan(rows[0].balance_milli) };
}

// ---------- admin ----------
export async function listUsers(db, { search = "", limit = 100 } = {}) {
    const rows = await db.query(
        `SELECT u.*,
            COALESCE((SELECT -SUM(delta_milli) FROM lw_ledger WHERE user_id = u.id AND delta_milli < 0 AND kind = 'usage'), 0) AS spent_milli
         FROM lw_users u
         WHERE $1 = '' OR u.username ILIKE '%' || $1 || '%'
         ORDER BY u.id DESC LIMIT $2`,
        [String(search).trim(), Math.min(Math.max(Number(limit) || 100, 1), 500)],
    );
    return rows.map((r) => ({ ...publicUser(r), spent: milliToYuan(r.spent_milli) }));
}

// Removes an account with its sessions and ledger. Accounts that still hold a
// balance must be zeroed first so paid money is never deleted by accident.
export async function deleteUser(db, userId) {
    const rows = await db.query("SELECT role, balance_milli FROM lw_users WHERE id = $1", [userId]);
    const user = rows[0];
    if (!user) throw new AccountError(404, "not_found", "这个用户不存在");
    if (user.role === "admin") throw new AccountError(400, "is_admin", "不能删除管理员账号");
    if (Number(user.balance_milli) > 0) throw new AccountError(400, "has_balance", "这个账号还有余额，先把余额调整为 0 再删除");
    await db.query("DELETE FROM lw_users WHERE id = $1", [userId]);
}

export async function setUserDisabled(db, userId, disabled) {
    await db.query("UPDATE lw_users SET disabled = $2 WHERE id = $1", [userId, Boolean(disabled)]);
    if (disabled) await db.query("DELETE FROM lw_sessions WHERE user_id = $1", [userId]);
}

export async function listCodes(db, { batch = "", limit = 200 } = {}) {
    const rows = await db.query(
        `SELECT c.code, c.amount_milli, c.batch, c.created_at, c.used_at, u.username AS used_by_name
         FROM lw_codes c LEFT JOIN lw_users u ON u.id = c.used_by
         WHERE $1 = '' OR c.batch = $1
         ORDER BY c.created_at DESC, c.code LIMIT $2`,
        [String(batch), Math.min(Math.max(Number(limit) || 200, 1), 1000)],
    );
    return rows.map((r) => ({
        code: r.code,
        amount: milliToYuan(r.amount_milli),
        batch: r.batch,
        createdAt: r.created_at,
        usedAt: r.used_at,
        usedBy: r.used_by_name || null,
    }));
}

export async function stats(db) {
    const rows = await db.query(
        `SELECT
            (SELECT COUNT(*) FROM lw_users) AS users,
            (SELECT COALESCE(SUM(balance_milli), 0) FROM lw_users) AS balance_milli,
            (SELECT COALESCE(SUM(delta_milli), 0) FROM lw_ledger WHERE kind IN ('redeem', 'admin') AND delta_milli > 0) AS topup_milli,
            (SELECT COALESCE(-SUM(delta_milli), 0) FROM lw_ledger WHERE kind = 'usage') AS usage_milli,
            (SELECT COUNT(*) FROM lw_codes WHERE used_by IS NULL) AS unused_codes`,
    );
    const r = rows[0];
    return {
        users: Number(r.users),
        totalBalance: milliToYuan(r.balance_milli),
        totalTopup: milliToYuan(r.topup_milli),
        totalUsage: milliToYuan(r.usage_milli),
        unusedCodes: Number(r.unused_codes),
    };
}
