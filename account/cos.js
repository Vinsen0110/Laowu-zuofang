// Result images delivered from Tencent Cloud COS in mainland China.
//
// The site's server sits in Hong Kong, which mainland users (China Mobile above
// all) reach at a few dozen KB/s. The server itself reaches suppliers and COS
// quickly, so it copies each result there once and sends users to the COS
// link. Originals are uploaded untouched: no re-encoding, no quality loss.
// When COS is not configured or an upload fails, callers fall back to serving
// the image from this server as before.

import { createHash, createHmac, randomBytes } from "node:crypto";
import { AccountError } from "./service.js";

const SETTINGS_KEY = "cos";
const REGION = /^[a-z]+-[a-z]+(?:-\d+)?$/;
const BUCKET = /^[a-z0-9][a-z0-9-]{0,48}-\d{5,12}$/;
export const COS_MAX_BYTES = 80 * 1024 * 1024;
const EXT = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" };

export async function getCos(db) {
    const rows = await db.query("SELECT value FROM lw_settings WHERE key = $1", [SETTINGS_KEY]);
    try {
        const v = JSON.parse(rows[0]?.value || "{}");
        return {
            secretId: String(v.secretId || ""),
            secretKey: String(v.secretKey || ""),
            bucket: String(v.bucket || ""),
            region: String(v.region || "ap-guangzhou"),
            enabled: v.enabled !== false,
        };
    } catch {
        return { secretId: "", secretKey: "", bucket: "", region: "ap-guangzhou", enabled: true };
    }
}

// What the admin page may see: never the secret itself.
export function publicCos(cos) {
    return {
        secretId: cos.secretId,
        hasSecret: !!cos.secretKey,
        bucket: cos.bucket,
        region: cos.region,
        enabled: cos.enabled,
        ready: cosReady(cos),
    };
}

export function cosReady(cos) {
    return !!(cos?.enabled && cos.secretId && cos.secretKey && BUCKET.test(cos.bucket) && REGION.test(cos.region));
}

export async function saveCos(db, input) {
    const current = await getCos(db);
    const next = {
        secretId: input?.secretId === undefined ? current.secretId : String(input.secretId).trim(),
        secretKey: input?.secretKey === undefined || input.secretKey === "" ? current.secretKey : String(input.secretKey).trim(),
        bucket: input?.bucket === undefined ? current.bucket : String(input.bucket).trim(),
        region: input?.region === undefined || input.region === "" ? current.region : String(input.region).trim(),
        enabled: input?.enabled === undefined ? current.enabled : input.enabled !== false && input.enabled !== "false",
    };
    if (next.bucket && !BUCKET.test(next.bucket)) {
        throw new AccountError(400, "bad_bucket", "存储桶名称格式不对，应类似 laowu-images-1250000000（名字-APPID）");
    }
    if (next.region && !REGION.test(next.region)) throw new AccountError(400, "bad_region", "地域格式不对，例如 ap-guangzhou");
    await db.query(
        `INSERT INTO lw_settings (key, value) VALUES ($1, $2)
         ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = now()`,
        [SETTINGS_KEY, JSON.stringify(next)],
    );
    return next;
}

export function cosHost(cos) {
    return `${cos.bucket}.cos.${cos.region}.myqcloud.com`;
}

export function cosPublicUrl(cos, key) {
    return `https://${cosHost(cos)}/${key.split("/").map(encodeURIComponent).join("/")}`;
}

const hmac = (key, text) => createHmac("sha1", key).update(text).digest("hex");
const sha1 = (text) => createHash("sha1").update(text).digest("hex");

// COS XML API signature (q-sign-algorithm=sha1), signing only the Host header.
export function cosAuthorization(cos, { method, path, host }, now = Math.floor(Date.now() / 1000)) {
    const keyTime = `${now - 60};${now + 600}`;
    const signKey = hmac(cos.secretKey, keyTime);
    const httpString = `${method.toLowerCase()}\n${path}\n\nhost=${encodeURIComponent(host).toLowerCase()}\n`;
    const stringToSign = `sha1\n${keyTime}\n${sha1(httpString)}\n`;
    const signature = hmac(signKey, stringToSign);
    return `q-sign-algorithm=sha1&q-ak=${cos.secretId}&q-sign-time=${keyTime}&q-key-time=${keyTime}&q-header-list=host&q-url-param-list=&q-signature=${signature}`;
}

export function resultKey(type, seed) {
    const ext = EXT[String(type || "").split(";")[0].trim().toLowerCase()] || "png";
    const day = new Date().toISOString().slice(0, 10).replaceAll("-", "");
    const name = seed
        ? createHash("sha256").update(String(seed)).digest("hex").slice(0, 40)
        : randomBytes(20).toString("hex");
    return `results/${day}/${name}.${ext}`;
}

export async function uploadToCos(cos, key, bytes, contentType, { fetchImpl = fetch, signal } = {}) {
    if (!cosReady(cos)) throw new Error("COS 未配置");
    const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    if (!data.length || data.length > COS_MAX_BYTES) throw new Error("图片大小不合适");
    const host = cosHost(cos);
    const path = `/${key.split("/").map(encodeURIComponent).join("/")}`;
    const response = await fetchImpl(`https://${host}${path}`, {
        method: "PUT",
        headers: {
            Authorization: cosAuthorization(cos, { method: "PUT", path, host }),
            "Content-Type": contentType || "application/octet-stream",
            "Cache-Control": "public, max-age=604800",
        },
        body: data,
        signal,
    });
    if (!response.ok) {
        const text = await response.text().catch(() => "");
        const code = text.match(/<Code>([^<]+)<\/Code>/)?.[1] || response.status;
        throw new Error(`COS 上传失败：${code}`);
    }
    return cosPublicUrl(cos, key);
}

// Gemini answers (土豆 Nano Banana) carry the picture inline as base64, often
// 10–14 MB. Swap each inline picture for a COS link the canvas already accepts
// (fileData.fileUri). Returns how many were swapped; leaves the payload as is
// when anything goes wrong.
// Gemini answers may nest the useful part under data / result / response.
function geminiLayers(value) {
    const out = [];
    const queue = Array.isArray(value) ? [...value] : [value];
    const seen = new Set();
    while (queue.length) {
        const item = queue.shift();
        if (!item || typeof item !== "object" || seen.has(item)) continue;
        seen.add(item);
        out.push(item);
        for (const key of ["data", "result", "response"]) if (item[key] && typeof item[key] === "object") queue.push(item[key]);
    }
    return out;
}

// A streamed (text/event-stream) answer becomes one JSON answer with every
// candidate, which the canvas reads the same way.
export function parseGeminiAnswer(text) {
    const trimmed = String(text || "").trim();
    if (!trimmed) return null;
    if (!trimmed.startsWith("data:")) {
        try { return JSON.parse(trimmed); } catch { return null; }
    }
    const candidates = [];
    for (const block of trimmed.split(/\r?\n\r?\n/)) {
        const data = block.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
        if (!data || data === "[DONE]") continue;
        let event;
        try { event = JSON.parse(data); } catch { continue; }
        for (const layer of geminiLayers(event)) if (Array.isArray(layer.candidates)) candidates.push(...layer.candidates);
    }
    return candidates.length ? { candidates } : null;
}

export async function moveInlineImagesToCos(cos, payload, options = {}) {
    if (!cosReady(cos) || !payload || typeof payload !== "object") return 0;
    const parts = [];
    for (const layer of geminiLayers(payload)) {
        for (const candidate of Array.isArray(layer?.candidates) ? layer.candidates : []) {
            for (const part of Array.isArray(candidate?.content?.parts) ? candidate.content.parts : []) {
                const inline = part?.inlineData || part?.inline_data;
                if (inline?.data && /^image\//i.test(inline.mimeType || inline.mime_type || "image/png")) parts.push(part);
            }
        }
    }
    let moved = 0;
    for (const part of parts) {
        const inline = part.inlineData || part.inline_data;
        const type = inline.mimeType || inline.mime_type || "image/png";
        const raw = String(inline.data).replace(/^data:[^;]+;base64,/, "");
        const bytes = Buffer.from(raw, "base64");
        const url = await uploadToCos(cos, resultKey(type), bytes, type, options);
        delete part.inlineData;
        delete part.inline_data;
        part.fileData = { mimeType: type, fileUri: url };
        moved++;
    }
    return moved;
}

// Supplier result links (渠道 2/4/5, and 渠道 3) copied to COS once; the same
// source always maps to the same COS key, so repeat views reuse the copy.
const copied = new Map();
const COPIED_LIMIT = 2000;

export async function copyResultToCos(cos, sourceUrl, { fetchImpl = fetch, signal } = {}) {
    if (!cosReady(cos)) return null;
    const known = copied.get(sourceUrl);
    if (known) return known;
    const upstream = await fetchImpl(sourceUrl, { redirect: "follow", signal });
    if (!upstream.ok) throw new Error(`结果图下载失败（${upstream.status}）`);
    const type = upstream.headers.get("content-type") || "image/png";
    if (!/^image\//i.test(type)) throw new Error("结果不是图片");
    const bytes = new Uint8Array(await upstream.arrayBuffer());
    const url = await uploadToCos(cos, resultKey(type, sourceUrl), bytes, type, { fetchImpl, signal });
    copied.set(sourceUrl, url);
    if (copied.size > COPIED_LIMIT) copied.delete(copied.keys().next().value);
    return url;
}

// The admin's "测试" button: upload a tiny PNG and read it back from the public link.
export async function testCos(cos, { fetchImpl = fetch } = {}) {
    if (!cosReady(cos)) throw new AccountError(400, "cos_not_ready", "请先填完整 SecretId、SecretKey、存储桶和地域");
    const png = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000" +
        "1f15c4890000000d49444154789c6360000002000154a24f6d0000000049454e44ae426082", "hex");
    let url;
    try {
        url = await uploadToCos(cos, `results/test/${randomBytes(8).toString("hex")}.png`, png, "image/png", { fetchImpl });
    } catch (error) {
        throw new AccountError(502, "cos_upload_failed", `${error.message}。请检查密钥、存储桶名称和权限`);
    }
    const back = await fetchImpl(url).catch(() => null);
    if (!back?.ok) throw new AccountError(502, "cos_read_failed", "上传成功但公开链接读不到：请把存储桶设为「公有读私有写」");
    return { ok: true, url };
}
