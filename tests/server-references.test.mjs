import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { REF_TTL_MS, readReference, saveReference, sniffImage, sweepReferences } from "../account/refs.js";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);

async function withDir(fn) {
    const dir = await mkdtemp(join(tmpdir(), "lw-refs-"));
    try { await fn(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}

test("reference images are stored under an unguessable name and read back", async () => {
    await withDir(async (dir) => {
        const name = await saveReference(PNG, { dir });
        assert.match(name, /^[a-f0-9]{32}\.png$/);
        const file = await readReference(name, { dir });
        assert.equal(file.type, "image/png");
        assert.deepEqual(new Uint8Array(file.bytes), PNG);
        assert.equal(await readReference("../etc/passwd", { dir }), null);
        assert.equal(await readReference("0123456789abcdef0123456789abcdef.png", { dir }), null);
    });
});

test("only real JPG, PNG or WebP files under 10 MB are accepted", async () => {
    await withDir(async (dir) => {
        assert.equal(sniffImage(JPG), "jpg");
        await assert.rejects(saveReference(new TextEncoder().encode("<script>"), { dir }), /只支持/);
        await assert.rejects(saveReference(new Uint8Array(0), { dir }), /空/);
        await assert.rejects(saveReference(new Uint8Array(10_000_001).fill(0xff), { dir }), /10 MB/);
    });
});

test("references disappear after 24 hours", async () => {
    await withDir(async (dir) => {
        const old = await saveReference(JPG, { dir });
        const fresh = await saveReference(PNG, { dir });
        const past = (Date.now() - REF_TTL_MS - 60_000) / 1000;
        await utimes(join(dir, old), past, past);
        assert.equal(await sweepReferences({ dir }), 1);
        assert.deepEqual(await readdir(dir), [fresh]);
        // Reading an expired file also removes it, even before the hourly sweep.
        await utimes(join(dir, fresh), past, past);
        assert.equal(await readReference(fresh, { dir }), null);
        assert.deepEqual(await readdir(dir), []);
    });
});

test("uploading needs a signed-in user; the stored link is public for the provider", async () => {
    await withDir(async (dir) => {
        process.env.LW_REF_DIR = dir;
        const { openMemoryDatabase } = await import("../account/db.js");
        const { handleAccountRequest } = await import("../account/http.js");
        const { register, login } = await import("../account/service.js");
        const db = await openMemoryDatabase();
        try {
            const call = (path, init = {}) => handleAccountRequest(new Request(`https://www.vinsen.top/api/account${path}`, init), { db });
            const anon = await call("/ref-upload", { method: "POST", body: PNG, headers: { "Content-Type": "image/png" } });
            assert.equal(anon.status, 401);

            await register(db, { email: "ref@test.com", password: "password123" });
            const { token } = await login(db, { email: "ref@test.com", password: "password123" });
            const up = await call("/ref-upload", { method: "POST", body: PNG, headers: { "Content-Type": "image/png", Cookie: `lw_session=${token}` } });
            assert.equal(up.status, 200);
            const { url } = await up.json();
            assert.match(url, /^https:\/\/www\.vinsen\.top\/api\/account\/ref\/[a-f0-9]{32}\.png$/);

            const read = await call(new URL(url).pathname.replace("/api/account", ""));
            assert.equal(read.status, 200);
            assert.equal(read.headers.get("content-type"), "image/png");
            assert.deepEqual(new Uint8Array(await read.arrayBuffer()), PNG);
        } finally {
            await db.close();
            delete process.env.LW_REF_DIR;
        }
    });
});

test("土豆 trusts reference links on this site's own domains only", async () => {
    const { isHostedReferenceImageUrl } = await import("../tudou-reference-images.js");
    const name = "0123456789abcdef0123456789abcdef";
    assert.equal(isHostedReferenceImageUrl(`https://www.vinsen.top/api/account/ref/${name}.jpg`), true);
    assert.equal(isHostedReferenceImageUrl(`https://evil.example/api/account/ref/${name}.jpg`), false);
    assert.equal(isHostedReferenceImageUrl(`http://www.vinsen.top/api/account/ref/${name}.jpg`), false);
});

test("users no longer see an image-host settings page", async () => {
    const { readFile } = await import("node:fs/promises");
    const bundle = await readFile(new URL("../assets/index-B2KJ37fm.js", import.meta.url), "utf8");
    assert.doesNotMatch(bundle, /label:"图床设置",onClick:\(\)=>n\("hosting"\)/);
    const upload = await readFile(new URL("../cloudinary-reference-upload.js", import.meta.url), "utf8");
    assert.match(upload, /if \(usesServerReferenceHost\(\)\) return uploadServerReferenceBlob\(original, options\);/);
});
