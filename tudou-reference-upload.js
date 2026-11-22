import { decodeImage, encodeImage } from "./cloudinary-reference-upload.js?v=20261122-tudouref-01";

// 土豆 reference images, without the user's Cloudinary image host:
// - GPT 2.6 takes public links: the image goes to this site's server, which puts it on
//   土豆's own upload (uploads.ai-tudou.net has no CORS). Links last 24 hours.
// - Nano Banana ignores links (tested 2026-11-22: the result did not follow the reference),
//   so the image goes inside the request itself.
// The original is sent untouched when it fits; only a bigger one is re-encoded (a copy —
// the canvas keeps the original), at full size first, and shrunk only if still too big.
export const TUDOU_UPLOAD_MAX_BYTES = 15 * 1024 * 1024;
// Gemini-style requests are capped near 20 MB and inline images grow by a third, so all
// of one request's references together stay under 14 MB.
export const TUDOU_INLINE_TOTAL_BYTES = 14 * 1024 * 1024;
const KEEP_TYPES = ["image/png", "image/jpeg", "image/webp"];
const QUALITIES = [0.95, 0.92, 0.88, 0.8];
const UPLOAD_TIMEOUT_MS = 180_000;
const LINK_KEY = "lw-tudou-references-v1";
const LINK_TTL_MS = 20 * 60 * 60 * 1000; // 土豆 deletes uploads after 24 hours
const LINK_LIMIT = 100;

function checkAbort(signal) {
    if (signal?.aborted) throw signal.reason || new DOMException("Aborted", "AbortError");
}

export function isTudouUploadUrl(value) {
    try {
        const url = new URL(String(value || ""));
        return url.protocol === "https:" && url.hostname === "img-cdn.ai-tudou.net";
    } catch {
        return false;
    }
}

async function readReferenceBlob(reference, options) {
    const source = reference.dataUrl || reference.url || "";
    let blob = reference.storageKey && options.readStoredBlob
        ? await options.readStoredBlob(reference.storageKey) : null;
    if (!blob) {
        const url = source || await options.readStoredUrl?.(reference.storageKey) || "";
        if (!url) throw new Error("参考图读取失败，请重新选择图片");
        const response = await (options.fetchImpl || fetch)(url, { signal: options.signal });
        if (!response.ok) throw new Error("参考图读取失败，请重新选择图片");
        blob = await response.blob();
    }
    checkAbort(options.signal);
    if (!blob?.size) throw new Error("参考图为空");
    return blob;
}

// The original if it is within maxBytes; otherwise the best-quality WebP copy that fits.
export async function fitTudouReference(blob, maxBytes, options = {}) {
    const { signal } = options;
    const type = String(blob.type || "").toLowerCase();
    if (blob.size <= maxBytes && KEEP_TYPES.includes(type)) return blob;
    const decoded = await (options.decodeImage || decodeImage)(blob);
    try {
        const { width, height } = decoded;
        if (!(width > 0 && height > 0)) throw new Error("参考图尺寸无效");
        const encode = options.encodeImage || encodeImage;
        let scale = 1;
        for (let step = 0; step < 12; step += 1) {
            const w = Math.max(1, Math.round(width * scale));
            const h = Math.max(1, Math.round(height * scale));
            for (const quality of QUALITIES) {
                checkAbort(signal);
                const copy = await encode(decoded.image, w, h, quality);
                if (copy?.size > 0 && copy.size <= maxBytes) return copy;
            }
            if (Math.max(w, h) <= 1024) break;
            scale *= 0.85;
        }
        throw new Error("参考图压缩后仍然太大，请换一张较小的图片；画布上的原图没有改动");
    } finally {
        decoded.dispose?.();
    }
}

function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error("参考图读取失败"));
        reader.readAsDataURL(blob);
    });
}

// Links already uploaded this day are reused (memory + localStorage), so regenerating
// with the same reference does not upload it again.
const links = new Map();

function storedLinks() {
    try { return JSON.parse(globalThis.localStorage?.getItem(LINK_KEY) || "{}") || {}; } catch { return {}; }
}

function knownLink(key) {
    const entry = links.get(key) || storedLinks()[key];
    return entry && isTudouUploadUrl(entry.url) && Date.now() - Number(entry.at) < LINK_TTL_MS ? entry.url : "";
}

function rememberLink(key, url) {
    const entry = { url, at: Date.now() };
    links.set(key, entry);
    try {
        if (!globalThis.localStorage) return;
        const now = Date.now();
        const kept = Object.entries(storedLinks()).filter(([k, v]) => k !== key && now - Number(v?.at) < LINK_TTL_MS);
        kept.push([key, entry]);
        globalThis.localStorage.setItem(LINK_KEY, JSON.stringify(Object.fromEntries(kept.slice(-LINK_LIMIT))));
    } catch {}
}

async function contentKey(blob) {
    if (!globalThis.crypto?.subtle) return "";
    const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

async function uploadTudouReference(blob, options) {
    const key = await contentKey(blob).catch(() => "");
    const known = key && knownLink(key);
    if (known) return known;
    const controller = new AbortController();
    const abort = () => controller.abort(options.signal.reason);
    options.signal?.addEventListener("abort", abort, { once: true });
    const timeout = setTimeout(() => controller.abort(new Error("参考图上传超时，请重试")), UPLOAD_TIMEOUT_MS);
    try {
        const response = await (options.fetchImpl || fetch)("/api/account/tudou-upload", {
            method: "POST",
            headers: { "Content-Type": blob.type },
            body: blob,
            credentials: "same-origin",
            signal: controller.signal,
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result?.error?.message || `参考图上传失败（${response.status}）`);
        if (!isTudouUploadUrl(result.url)) throw new Error("参考图上传后没有拿到有效链接");
        if (key) rememberLink(key, result.url);
        return result.url;
    } catch (error) {
        if (controller.signal.aborted) throw controller.signal.reason;
        throw error;
    } finally {
        clearTimeout(timeout);
        options.signal?.removeEventListener("abort", abort);
    }
}

// One reference for a 土豆 image request: a 土豆 link (GPT 2.6) or a data URL (Nano Banana).
// options: { nano, count, signal, onProgress, readStoredBlob, readStoredUrl, fetchImpl }
export async function tudouReferenceSource(reference, options = {}) {
    checkAbort(options.signal);
    const source = reference.dataUrl || reference.url || "";
    if (!options.nano && isTudouUploadUrl(source)) return source;
    options.onProgress?.({ stage: "preparing", progress: 2 });
    const original = await readReferenceBlob(reference, options);
    const maxBytes = options.nano
        ? Math.min(TUDOU_UPLOAD_MAX_BYTES, Math.floor(TUDOU_INLINE_TOTAL_BYTES / Math.max(1, Number(options.count) || 1)))
        : TUDOU_UPLOAD_MAX_BYTES;
    const blob = await fitTudouReference(original, maxBytes, options);
    checkAbort(options.signal);
    if (options.nano) return blobToDataUrl(blob);
    options.onProgress?.({ stage: "uploading", progress: 3 });
    const url = await uploadTudouReference(blob, options);
    options.onProgress?.({ stage: "uploading", progress: 10 });
    return url;
}
