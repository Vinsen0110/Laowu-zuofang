// Keeps the site's suppliers out of what users see in the browser: relay
// targets travel as opaque tokens, supplier names are scrubbed from error
// texts, and result URLs are served through /api/account/img.

import { createHmac, timingSafeEqual } from "node:crypto";

// Must match maskTarget() in index.html.
const MASK_KEY = "laowu-zuofang";

function xor(bytes) {
    const key = Buffer.from(MASK_KEY);
    return Buffer.from(bytes.map((b, i) => b ^ key[i % key.length]));
}

export function maskTarget(url) {
    return xor(Buffer.from(String(url), "utf8")).toString("base64url");
}

export function unmaskTarget(token) {
    return xor(Buffer.from(String(token || ""), "base64url")).toString("utf8");
}

export const CHANNEL_LABELS = { tudou: "渠道 1", apimart: "渠道 2", grsai: "渠道 3", runninghub: "渠道 4", soon: "渠道 5" };

const NAME_PATTERNS = [
    [/ai-tudou|tudou|土豆/gi, CHANNEL_LABELS.tudou],
    [/api\s*mart|apimart/gi, CHANNEL_LABELS.apimart],
    [/grsai/gi, CHANNEL_LABELS.grsai],
    [/runninghub|rhart/gi, CHANNEL_LABELS.runninghub],
    [/soonstudio|soon studio/gi, CHANNEL_LABELS.soon],
];

export function scrubText(text) {
    let out = String(text ?? "").replace(/https?:\/\/[^\s"'<>)]+/gi, "[链接已隐藏]");
    for (const [re, label] of NAME_PATTERNS) out = out.replace(re, label);
    return out;
}

function secret() {
    return String(process.env.LW_IMG_SECRET || process.env.DATABASE_URL || "laowu-local-preview");
}

function sign(url) {
    return createHmac("sha256", secret()).update(url).digest("base64url").slice(0, 22);
}

export function imageToken(url) {
    return `${maskTarget(url)}.${sign(url)}`;
}

export function verifyImageToken(token) {
    const [body, mac] = String(token || "").split(".");
    if (!body || !mac) return null;
    const url = unmaskTarget(body);
    const expected = Buffer.from(sign(url));
    const actual = Buffer.from(mac);
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
    try {
        return new URL(url).protocol === "https:" ? url : null;
    } catch {
        return null;
    }
}

// Rewrites every external https URL inside a JSON value to the image proxy.
export function rewriteUrls(value, origin) {
    if (typeof value === "string") {
        if (/^https:\/\//i.test(value) && !value.startsWith(origin)) {
            return `${origin}/api/account/img?t=${imageToken(value)}`;
        }
        return value;
    }
    if (Array.isArray(value)) return value.map((v) => rewriteUrls(v, origin));
    if (value && typeof value === "object") {
        return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, rewriteUrls(v, origin)]));
    }
    return value;
}
