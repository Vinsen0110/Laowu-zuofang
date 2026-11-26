import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { copyResultToCos } from "../account/cos.js";
import { deliveryCos, tudouGeminiAnswer } from "../account/tudou-cos.js";

// 2026-11-25 实测：土豆 33 秒出的 2K 香蕉图，从香港服务器下到大陆又花了 88 秒。
// 后台选「腾讯云 COS」时，土豆结果改从广州 COS 下载；原图原样上传，不重新编码。

const cos = { secretId: "AKIDexample", secretKey: "secret", bucket: "laowu-images-1250000000", region: "ap-guangzhou", enabled: true, delivery: "cos" };
const picture = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");

function fakeCos({ fail = false } = {}) {
    const puts = [];
    const fetchImpl = async (url, init = {}) => {
        if (init.method === "PUT") {
            puts.push({ url, type: init.headers["Content-Type"], bytes: Buffer.from(init.body) });
            return fail ? new Response("<Error><Code>AccessDenied</Code></Error>", { status: 403 }) : new Response("", { status: 200 });
        }
        return new Response(picture, { headers: { "content-type": "image/png" } });
    };
    return { puts, fetchImpl };
}

const geminiReply = (extra = {}) => ({
    candidates: [{ content: { parts: [{ text: "好的" }, { inlineData: { mimeType: "image/png", data: picture.toString("base64") }, thoughtSignature: "x".repeat(5000), ...extra }] } }],
});
const frame = (text) => JSON.parse(text.replace(/^data: /, "").trim());

test("后台选「直连平台」或 COS 没配好时，不走 COS", () => {
    assert.equal(deliveryCos({ ...cos, delivery: "direct" }), null);
    assert.equal(deliveryCos({ ...cos, secretKey: "" }), null);
    assert.equal(deliveryCos(cos), cos);
});

test("香蕉结果：图片原样放到 COS，回给浏览器的是 COS 链接（画布认 fileData.fileUri）", async () => {
    const { puts, fetchImpl } = fakeCos();
    const out = frame(await tudouGeminiAnswer(JSON.stringify(geminiReply()), cos, { fetchImpl }));
    assert.equal(puts.length, 1);
    assert.deepEqual(puts[0].bytes, picture, "上传的字节必须和土豆给的完全一样");
    assert.match(puts[0].url, /^https:\/\/laowu-images-1250000000\.cos\.ap-guangzhou\.myqcloud\.com\/results\/\d{8}\/[0-9a-f]{40}\.png$/);
    const part = out.candidates[0].content.parts[1];
    assert.equal(part.inlineData, undefined);
    assert.equal(part.fileData.fileUri, puts[0].url);
    assert.equal(part.thoughtSignature, undefined, "几 MB 的签名不用再发给浏览器");
    assert.equal(out.candidates[0].content.parts[0].text, "好的");
});

test("土豆返回 SSE 流时同样处理", async () => {
    const { puts, fetchImpl } = fakeCos();
    const raw = `data: ${JSON.stringify(geminiReply())}\n\n`;
    const out = frame(await tudouGeminiAnswer(raw, cos, { fetchImpl }));
    assert.equal(puts.length, 1);
    assert.equal(out.candidates[0].content.parts[1].fileData.fileUri, puts[0].url);
});

test("COS 上传失败：照旧把原图从服务器发出去，不让生成失败", async () => {
    const { fetchImpl } = fakeCos({ fail: true });
    const errors = [];
    const raw = JSON.stringify(geminiReply());
    const out = frame(await tudouGeminiAnswer(raw, cos, { fetchImpl, onError: (e) => errors.push(e.message) }));
    assert.equal(errors.length, 1);
    assert.equal(out.candidates[0].content.parts[1].inlineData.data, picture.toString("base64"));
});

test("不走 COS 时原样转发；土豆报错照样转给画布", async () => {
    const raw = JSON.stringify(geminiReply());
    assert.deepEqual(frame(await tudouGeminiAnswer(raw, null)), JSON.parse(raw));
    const sse = `data: ${raw}\n\n`;
    assert.equal(await tudouGeminiAnswer(sse, null), sse);
    const blocked = JSON.stringify({ candidates: [{ finishReason: "SAFETY", content: { parts: [{ text: "不能生成" }] } }] });
    const { puts, fetchImpl } = fakeCos();
    assert.deepEqual(frame(await tudouGeminiAnswer(blocked, cos, { fetchImpl })), JSON.parse(blocked));
    assert.equal(puts.length, 0);
});

test("GPT 结果图：画布同时取三次，只下载、上传一次", async () => {
    const { puts, fetchImpl } = fakeCos();
    let downloads = 0;
    const counting = async (url, init) => { if (!init?.method) downloads++; return fetchImpl(url, init); };
    const src = `https://pub-${"a".repeat(32)}.r2.dev/image-hub/2026/11/25/dedupe-${Date.now()}.png`;
    const urls = await Promise.all([1, 2, 3].map(() => copyResultToCos(cos, src, { fetchImpl: counting })));
    assert.equal(new Set(urls).size, 1);
    assert.equal(downloads, 1);
    assert.equal(puts.length, 1);
    assert.deepEqual(puts[0].bytes, picture);
});

test("服务器：香蕉转发和 /api/tudou-image 在选 COS 时改发广州链接，出错退回原方式", async () => {
    const server = await readFile(new URL("../local-preview-server.mjs", import.meta.url), "utf8");
    const gemini = server.slice(server.indexOf("async function proxyTudouGeminiStream("), server.indexOf("async function proxyTudouApi("));
    assert.match(gemini, /const cos = upstream\.ok && upstream\.body \? await resultCos\(\) : null;/);
    assert.match(gemini, /tudouGeminiAnswer\(await upstream\.text\(\), cos,/);
    // 心跳要等 COS 链接写出前才停，否则上传期间连接没动静。
    assert.ok(gemini.indexOf("tudouGeminiAnswer(") < gemini.indexOf("clearInterval(heartbeat);"));
    const image = server.slice(server.indexOf("async function proxyTudouImage("), server.indexOf("async function proxyApiMartImage("));
    assert.match(image, /const url = await copyResultToCos\(cos, target\.href\);/);
    assert.match(image, /response\.writeHead\(302, \{ Location: url/);
    assert.match(image, /Tudou image to COS failed, sending it from this server/);
    assert.match(server, /return deliveryCos\(await getCos\(await getDatabase\(\)\)\);/);
});
