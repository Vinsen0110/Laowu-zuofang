// Email verification codes for sign-up and password reset.

import { createHash, randomInt, timingSafeEqual } from "node:crypto";

import { devCodesVisible, sendCodeEmail } from "./mailer.js";
import { AccountError, hashPassword, normalizeEmail } from "./service.js";

export const VERIFY_SCHEMA = `
ALTER TABLE lw_users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT FALSE;
CREATE TABLE IF NOT EXISTS lw_email_codes (
    email      TEXT NOT NULL,
    purpose    TEXT NOT NULL,
    code_hash  TEXT NOT NULL,
    attempts   INTEGER NOT NULL DEFAULT 0,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (email, purpose)
);
CREATE TABLE IF NOT EXISTS lw_email_sends (
    id         BIGSERIAL PRIMARY KEY,
    email      TEXT NOT NULL,
    ip         TEXT NOT NULL DEFAULT '',
    purpose    TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE lw_email_sends ADD COLUMN IF NOT EXISTS purpose TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS lw_email_sends_email ON lw_email_sends(email, created_at);
CREATE INDEX IF NOT EXISTS lw_email_sends_ip ON lw_email_sends(ip, created_at);
`;

export const CODE_TTL_MINUTES = 10;
const RESEND_SECONDS = 60;
const MAX_PER_EMAIL_HOUR = 8;
const MAX_PER_IP_HOUR = 30;
const MAX_ATTEMPTS = 5;
const PURPOSES = new Set(["register", "reset"]);

function codeHash(email, purpose, code) {
    return createHash("sha256").update(`${email}:${purpose}:${code}`).digest("hex");
}

async function userExists(db, email) {
    const rows = await db.query("SELECT 1 FROM lw_users WHERE lower(username) = lower($1)", [email]);
    return rows.length > 0;
}

export async function requestCode(db, { email, purpose, ip = "" }, { send = sendCodeEmail } = {}) {
    if (!PURPOSES.has(purpose)) throw new AccountError(400, "bad_purpose", "请求类型不正确");
    const addr = normalizeEmail(email);
    const exists = await userExists(db, addr);
    if (purpose === "register" && exists) throw new AccountError(409, "email_taken", "这个邮箱已经注册过了，请直接登录");
    if (purpose === "reset" && !exists) throw new AccountError(404, "no_account", "这个邮箱还没有注册");

    const [recent] = await db.query(
        `SELECT
            (SELECT EXTRACT(EPOCH FROM now() - MAX(created_at)) FROM lw_email_sends WHERE email = $1 AND purpose = $3) AS since_last,
            (SELECT COUNT(*) FROM lw_email_sends WHERE email = $1 AND created_at > now() - interval '1 hour') AS per_email,
            (SELECT COUNT(*) FROM lw_email_sends WHERE ip = $2 AND $2 <> '' AND created_at > now() - interval '1 hour') AS per_ip`,
        [addr, ip, purpose],
    );
    const sinceLast = recent.since_last == null ? Infinity : Number(recent.since_last);
    if (sinceLast < RESEND_SECONDS) {
        throw new AccountError(429, "too_soon", `发送太频繁，请 ${Math.ceil(RESEND_SECONDS - sinceLast)} 秒后再试`);
    }
    if (Number(recent.per_email) >= MAX_PER_EMAIL_HOUR || Number(recent.per_ip) >= MAX_PER_IP_HOUR) {
        throw new AccountError(429, "too_many", "验证码发送次数过多，请 1 小时后再试");
    }

    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    await db.query(
        `INSERT INTO lw_email_codes (email, purpose, code_hash, attempts, expires_at)
         VALUES ($1, $2, $3, 0, now() + make_interval(mins => $4))
         ON CONFLICT (email, purpose) DO UPDATE SET code_hash = $3, attempts = 0, expires_at = now() + make_interval(mins => $4), created_at = now()`,
        [addr, purpose, codeHash(addr, purpose, code), CODE_TTL_MINUTES],
    );
    await db.query("INSERT INTO lw_email_sends (email, ip, purpose) VALUES ($1, $2, $3)", [addr, String(ip).slice(0, 64), purpose]);
    try {
        await send(addr, code, purpose);
    } catch (error) {
        await db.query("DELETE FROM lw_email_codes WHERE email = $1 AND purpose = $2", [addr, purpose]);
        throw new AccountError(502, "mail_failed", error instanceof Error ? error.message : "验证码邮件发送失败");
    }
    return { sent: true, resendAfter: RESEND_SECONDS, ...(devCodesVisible() ? { devCode: code } : {}) };
}

export async function consumeCode(db, { email, purpose, code }) {
    const addr = normalizeEmail(email);
    const input = String(code ?? "").replace(/\D/g, "");
    if (input.length !== 6) throw new AccountError(400, "bad_code", "请输入 6 位验证码");
    const rows = await db.query(
        "SELECT code_hash, attempts, expires_at > now() AS valid FROM lw_email_codes WHERE email = $1 AND purpose = $2",
        [addr, purpose],
    );
    const row = rows[0];
    if (!row || !row.valid) throw new AccountError(400, "code_expired", "验证码已过期或不存在，请重新获取");
    if (Number(row.attempts) >= MAX_ATTEMPTS) throw new AccountError(429, "code_locked", "验证码错误次数过多，请重新获取");
    const expected = Buffer.from(row.code_hash, "hex");
    const actual = Buffer.from(codeHash(addr, purpose, input), "hex");
    if (!timingSafeEqual(expected, actual)) {
        await db.query("UPDATE lw_email_codes SET attempts = attempts + 1 WHERE email = $1 AND purpose = $2", [addr, purpose]);
        const left = MAX_ATTEMPTS - Number(row.attempts) - 1;
        throw new AccountError(400, "wrong_code", left > 0 ? `验证码不正确，还可以再试 ${left} 次` : "验证码错误次数过多，请重新获取");
    }
    // Delete only if still the same code: two concurrent uses → only one succeeds.
    const deleted = await db.query(
        "DELETE FROM lw_email_codes WHERE email = $1 AND purpose = $2 AND code_hash = $3 RETURNING 1",
        [addr, purpose, row.code_hash],
    );
    if (!deleted[0]) throw new AccountError(400, "code_expired", "验证码已失效，请重新获取");
    return addr;
}

export async function markVerified(db, email) {
    await db.query("UPDATE lw_users SET email_verified = TRUE WHERE lower(username) = lower($1)", [email]);
}

export async function resetPassword(db, { email, code, password }) {
    const pw = String(password ?? "");
    if (pw.length < 8 || pw.length > 72) throw new AccountError(400, "bad_password", "密码需为 8–72 位");
    const addr = await consumeCode(db, { email, purpose: "reset", code });
    const hash = await hashPassword(pw);
    const rows = await db.query(
        "UPDATE lw_users SET password_hash = $1, email_verified = TRUE WHERE lower(username) = lower($2) RETURNING id",
        [hash, addr],
    );
    if (!rows[0]) throw new AccountError(404, "no_account", "这个邮箱还没有注册");
    await db.query("DELETE FROM lw_sessions WHERE user_id = $1", [rows[0].id]);
    await db.query("DELETE FROM lw_device_tokens WHERE user_id = $1", [rows[0].id]);
    await db.query("DELETE FROM lw_login_attempts WHERE key = $1", [`login:${addr}`]);
    return addr;
}
