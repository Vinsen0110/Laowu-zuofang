import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
    TUDOU_INLINE_TOTAL_BYTES,
    TUDOU_UPLOAD_MAX_BYTES,
    fitTudouReference,
    isTudouUploadUrl,
    tudouReferenceSource,
} from "../tudou-reference-upload.js";

// Node has Blob but no FileReader; enough of one for readAsDataURL.
globalThis.FileReader ??= class {
    readAsDataURL(blob) {
        blob.arrayBuffer().then((buffer) => {
            this.result = `data:${blob.type};base64,${Buffer.from(buffer).toString("base64")}`;
            this.onload?.();
        }, () => this.onerror?.());
    }
};

const MB = 1024 * 1024;
const png = (bytes) => new Blob([new Uint8Array(bytes)], { type: "image/png" });

function fakeCodec(sizeFor) {
    const calls = [];
    return {
        calls,
        decodeImage: async () => ({ image: "img", width: 4000, height: 3000, dispose() {} }),
        encodeImage: async (_image, width, height, quality) => {
            calls.push([width, height, quality]);
            return new Blob([new Uint8Array(sizeFor(width, height, quality))], { type: "image/webp" });
        },
    };
}

test("a reference within the limit is sent untouched", async () => {
    const original = png(1000);
    const codec = fakeCodec(() => 10);
    assert.equal(await fitTudouReference(original, TUDOU_UPLOAD_MAX_BYTES, codec), original);
    assert.deepEqual(codec.calls, []);
});

test("an oversized reference is re-encoded at full size first, and shrunk only when still too big", async () => {
    const big = { size: 20 * MB, type: "image/png" };
    const fullSize = fakeCodec((w, h, q) => (q <= 0.92 ? 14 * MB : 16 * MB));
    const copy = await fitTudouReference(big, 15 * MB, fullSize);
    assert.equal(copy.size, 14 * MB);
    assert.deepEqual(fullSize.calls, [[4000, 3000, 0.95], [4000, 3000, 0.92]]);

    const shrink = fakeCodec((w) => (w >= 4000 ? 16 * MB : 15 * MB));
    await fitTudouReference(big, 15 * MB, shrink);
    assert.equal(shrink.calls.at(-1)[0], 3400);
    assert.ok(shrink.calls.every(([w]) => w <= 4000));
});

test("GPT 2.6 references are uploaded through this site once and the 土豆 link is reused", async () => {
    const uploads = [];
    const fetchImpl = async (url, init) => {
        if (url === "/api/account/tudou-upload") {
            uploads.push(init.headers["Content-Type"]);
            return Response.json({ url: "https://img-cdn.ai-tudou.net/i/2026/11/22/abc.png" });
        }
        throw new Error("unexpected " + url);
    };
    const reference = { storageKey: "k1" };
    const options = { nano: false, readStoredBlob: async () => png(2048), fetchImpl };
    assert.equal(await tudouReferenceSource(reference, options), "https://img-cdn.ai-tudou.net/i/2026/11/22/abc.png");
    assert.equal(await tudouReferenceSource(reference, options), "https://img-cdn.ai-tudou.net/i/2026/11/22/abc.png");
    assert.deepEqual(uploads, ["image/png"]);
    // An existing 土豆 link goes straight through.
    assert.equal(await tudouReferenceSource({ url: "https://img-cdn.ai-tudou.net/i/x.png" }, { fetchImpl }), "https://img-cdn.ai-tudou.net/i/x.png");
});

test("Nano Banana references go inline, within a shared size budget, with no upload", async () => {
    const fetchImpl = async () => { throw new Error("must not upload"); };
    const dataUrl = await tudouReferenceSource({ storageKey: "k" }, { nano: true, count: 1, readStoredBlob: async () => png(3), fetchImpl });
    assert.equal(dataUrl, "data:image/png;base64,AAAA");

    const codec = fakeCodec(() => 1 * MB);
    const original = { size: 6 * MB, type: "image/png" };
    await tudouReferenceSource({ storageKey: "k" }, { nano: true, count: 3, readStoredBlob: async () => original, fetchImpl, ...codec });
    assert.ok(codec.calls.length > 0, "6 MB is over a third of the inline budget");
    assert.ok(TUDOU_INLINE_TOTAL_BYTES / 3 < 6 * MB);
});

test("only 土豆's upload host counts as a 土豆 link", () => {
    assert.equal(isTudouUploadUrl("https://img-cdn.ai-tudou.net/i/a.png"), true);
    assert.equal(isTudouUploadUrl("https://res.cloudinary.com/x/image/upload/a.png"), false);
    assert.equal(isTudouUploadUrl("http://img-cdn.ai-tudou.net/i/a.png"), false);
});

test("the canvas sends 土豆 references through tudouReferenceSource, not Cloudinary", async () => {
    const bundle = await readFile(new URL("../assets/index-B2KJ37fm.js", import.meta.url), "utf8");
    assert.match(bundle, /import\{tudouReferenceSource\}from"\.\.\/tudou-reference-upload\.js\?v=/);
    assert.match(bundle, /withTudouReferenceAspectRatio\(a,n\),g=await Promise\.all\(n\.map\(v=>tudouReferenceSource\(v,\{nano:isTudouNanoImageConfig\(h\),count:n\.length/);
    // Inline images are capped by the module, so the 4 MB web check leaves them out.
    assert.equal(bundle.split('JSON.stringify(t,(k,v)=>k==="inlineData"?void 0:v)').length - 1, 2);
});
