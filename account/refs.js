// Reference images for providers that fetch a public link (土豆, Grsai). Users
// upload here instead of to an image host; each file gets an unguessable name
// and is deleted after 24 hours, since a reference is only needed while the
// provider downloads it.

import { randomBytes } from "node:crypto";
import { mkdir, readdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const REF_MAX_BYTES = 10_000_000;
export const REF_TTL_MS = 24 * 60 * 60 * 1000;
const SWEEP_EVERY_MS = 60 * 60 * 1000;
const NAME = /^[a-f0-9]{32}\.(jpg|png|webp)$/;
const TYPES = { jpg: "image/jpeg", png: "image/png", webp: "image/webp" };

export function referenceDir() {
    return process.env.LW_REF_DIR || join(process.cwd(), ".local-data", "refs");
}

// Trust the bytes, not the declared type.
export function sniffImage(bytes) {
    const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "png";
    if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpg";
    if (b.length > 12 && String.fromCharCode(...b.subarray(0, 4)) === "RIFF"
        && String.fromCharCode(...b.subarray(8, 12)) === "WEBP") return "webp";
    return null;
}

export async function saveReference(bytes, { dir = referenceDir() } = {}) {
    const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    if (!data.length) throw Object.assign(new Error("参考图是空的"), { status: 400, code: "empty" });
    if (data.length > REF_MAX_BYTES) throw Object.assign(new Error("参考图超过 10 MB"), { status: 413, code: "too_large" });
    const ext = sniffImage(data);
    if (!ext) throw Object.assign(new Error("只支持 JPG、PNG、WebP 参考图"), { status: 415, code: "bad_type" });
    await mkdir(dir, { recursive: true });
    const name = `${randomBytes(16).toString("hex")}.${ext}`;
    await writeFile(join(dir, name), data, { mode: 0o640 });
    return name;
}

export async function readReference(name, { dir = referenceDir(), now = Date.now() } = {}) {
    if (!NAME.test(String(name || ""))) return null;
    const file = join(dir, name);
    try {
        const info = await stat(file);
        if (now - info.mtimeMs > REF_TTL_MS) {
            await unlink(file).catch(() => {});
            return null;
        }
        return { bytes: await readFile(file), type: TYPES[name.split(".").pop()] };
    } catch {
        return null;
    }
}

export async function sweepReferences({ dir = referenceDir(), now = Date.now() } = {}) {
    let removed = 0;
    let names = [];
    try { names = await readdir(dir); } catch { return 0; }
    for (const name of names) {
        if (!NAME.test(name)) continue;
        try {
            const info = await stat(join(dir, name));
            if (now - info.mtimeMs > REF_TTL_MS) {
                await unlink(join(dir, name));
                removed++;
            }
        } catch { /* already gone */ }
    }
    return removed;
}

let sweeping = null;
export function startReferenceSweeper() {
    if (sweeping) return;
    sweepReferences().catch(() => {});
    sweeping = setInterval(() => sweepReferences().catch(() => {}), SWEEP_EVERY_MS);
    sweeping.unref?.();
}
