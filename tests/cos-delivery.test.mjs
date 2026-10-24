import assert from "node:assert/strict";
import test from "node:test";

import {
    copyResultToCos, cosAuthorization, cosReady, dropUnusedSignatures, largestStrings, moveInlineImagesToCos, parseGeminiAnswer, publicCos, resultKey,
} from "../account/cos.js";

const cos = { secretId: "AKIDexample", secretKey: "secret", bucket: "laowu-images-1250000000", region: "ap-guangzhou", enabled: true };
const ok = () => new Response("", { status: 200 });

test("COS is only used when every setting is filled in", () => {
    assert.equal(cosReady(cos), true);
    assert.equal(cosReady({ ...cos, secretKey: "" }), false);
    assert.equal(cosReady({ ...cos, bucket: "no-appid" }), false);
    assert.equal(cosReady({ ...cos, enabled: false }), false);
    assert.deepEqual(Object.keys(publicCos(cos)).includes("secretKey"), false);
});

test("requests are signed with the host header and a short key time", () => {
    const auth = cosAuthorization(cos, { method: "PUT", path: "/results/a.png", host: "laowu-images-1250000000.cos.ap-guangzhou.myqcloud.com" }, 1_700_000_000);
    assert.match(auth, /^q-sign-algorithm=sha1&q-ak=AKIDexample&q-sign-time=1699999940;1700000600&q-key-time=1699999940;1700000600&q-header-list=host&q-url-param-list=&q-signature=[a-f0-9]{40}$/);
    assert.equal(auth, cosAuthorization(cos, { method: "PUT", path: "/results/a.png", host: "laowu-images-1250000000.cos.ap-guangzhou.myqcloud.com" }, 1_700_000_000));
});

test("result keys keep the image type and repeat for the same source", () => {
    assert.match(resultKey("image/jpeg"), /^results\/\d{8}\/[a-f0-9]{40}\.jpg$/);
    assert.equal(resultKey("image/png", "https://x/a.png"), resultKey("image/png", "https://x/a.png"));
});

test("土豆's inline picture is uploaded untouched and replaced by its COS link", async () => {
    const original = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);
    const sse = `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: "ok" }] } }] })}\n\n`
        + `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: original.toString("base64") } }] } }] })}\n\n`;
    const payload = parseGeminiAnswer(sse);
    let uploaded = null;
    const moved = await moveInlineImagesToCos(cos, payload, { fetchImpl: async (url, init) => { uploaded = { url, init }; return ok(); } });
    assert.equal(moved, 1);
    assert.equal(uploaded.init.method, "PUT");
    assert.deepEqual(Buffer.from(uploaded.init.body), original, "bytes must be the original, not re-encoded");
    const part = payload.candidates[1].content.parts[0];
    assert.equal(part.inlineData, undefined);
    assert.match(part.fileData.fileUri, /^https:\/\/laowu-images-1250000000\.cos\.ap-guangzhou\.myqcloud\.com\/results\/\d{8}\/[a-f0-9]{40}\.png$/);
});

test("supplier result links are copied to COS once", async () => {
    let downloads = 0;
    const fetchImpl = async (url, init = {}) => {
        if (init.method === "PUT") return ok();
        downloads++;
        return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": "image/png" } });
    };
    const source = `https://supplier.example/out-${Date.now()}.png`;
    const first = await copyResultToCos(cos, source, { fetchImpl });
    const again = await copyResultToCos(cos, source, { fetchImpl });
    assert.equal(first, again);
    assert.equal(downloads, 1);
});

test("an upload error surfaces so the caller can fall back to this server", async () => {
    await assert.rejects(
        moveInlineImagesToCos(cos, { candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: "AAAA" } }] } }] },
            { fetchImpl: async () => new Response("<Error><Code>AccessDenied</Code></Error>", { status: 403 }) }),
        /AccessDenied/,
    );
});

test("the encrypted signature next to a picture is dropped, a function call keeps its own", async () => {
    const payload = { candidates: [{ content: { parts: [
        { inlineData: { mimeType: "image/png", data: "AAAA" }, thoughtSignature: "x".repeat(50_000) },
        { functionCall: { name: "tool", args: {} }, thoughtSignature: "keep" },
    ] } }] };
    await moveInlineImagesToCos(cos, payload, { fetchImpl: async () => ok() });
    assert.equal(dropUnusedSignatures(payload), 50_000);
    const [picture, call] = payload.candidates[0].content.parts;
    assert.equal(picture.thoughtSignature, undefined);
    assert.match(picture.fileData.fileUri, /^https:\/\//);
    assert.equal(call.thoughtSignature, "keep");
    assert.ok(JSON.stringify(payload).length < 1_000);
});

test("the server log names the biggest strings by path and length only", () => {
    assert.deepEqual(largestStrings({ a: { b: "y".repeat(20_000) }, c: "short" }), ["a.b=20000"]);
});
