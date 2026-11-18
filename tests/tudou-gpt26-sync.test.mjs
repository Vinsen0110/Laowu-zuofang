import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

import { describeRequest } from "../account/describe.js";

// 土豆 retired the -async 2.6 models on 2026-11-18; 2.6 is now OpenAI-style and synchronous.
const bundle = await readFile(new URL("../assets/index-B2KJ37fm.js", import.meta.url), "utf8");

function functionSource(name) {
    let start = bundle.indexOf(`function ${name}(`);
    assert.notEqual(start, -1, `${name} must exist in the shipped bundle`);
    if (bundle.slice(start - 6, start) === "async ") start -= 6;
    for (let end = bundle.indexOf("}", start); end !== -1; end = bundle.indexOf("}", end + 1)) {
        const candidate = bundle.slice(start, end + 1);
        try {
            new vm.Script(`(${candidate})`);
            return candidate;
        } catch (error) {
            if (!(error instanceof SyntaxError)) throw error;
        }
    }
    throw new Error(`Cannot extract ${name}`);
}

function constSource(name) {
    const match = bundle.match(new RegExp(`(?:const |,)${name}=(\\{[^;]*\\}|\\[[^\\]]*\\])[;,]`));
    assert.ok(match, `${name} must exist in the shipped bundle`);
    return `var ${name}=${match[1]};`;
}

function runtime(hostname = "www.vinsen.top") {
    const calls = [];
    const context = vm.createContext({
        location: { hostname, origin: `https://${hostname}` },
        URL,
        pr: (value) => String(value).split("::").at(-1),
        jMe: (value) => String(value).startsWith("nano-banana-pro"),
        Zq: (_config, prompt) => prompt,
        xA: (_config, path) => `https://api.ai-tudou.net/v1${path}`,
        wA: () => ({ Authorization: "Bearer test" }),
        cn: () => "id",
        reportImageTaskProgress: () => {},
        lwTudouDirect: async (_config, url, payload, run) => {
            calls.push({ url, payload });
            return run();
        },
        Ln: {
            post: async (url, body) => {
                calls.at(-1).posted = { url, body };
                return { data: { created: 1, data: [{ url: "https://pub-1319f2cb116e4b0a8d8ce240527c6332.r2.dev/image-hub/2026/11/18/a.png" }] } };
            },
        },
    });
    vm.runInContext(constSource("TUDOU_GPT_ASPECT_RATIOS"), context);
    vm.runInContext(constSource("TUDOU_GPT26_PIXELS"), context);
    for (const name of ["isTudouNano21Model", "tudouResolution", "tudouQuality", "tudouGpt25Variant", "tudouBackendModel",
        "tudouGptSize", "isTudouGpt26", "tudouGpt26Size", "tudouResultUrl", "tudouGptImagePayload", "_Me", "Qq", "submitTudouGptImages"]) {
        vm.runInContext(functionSource(name), context);
    }
    return { context, calls };
}

const config = (patch = {}) => ({ provider: "tudou", model: "tudou::gpt-image-2.6", systemPrompt: "", ...patch });

test("2.6 sends a measured pixel size for every ratio at 1K, 2K and 4K", () => {
    const { context } = runtime();
    for (const [size, quality, expected] of [
        ["auto", "1k", "1024x1024"], ["1:1", "2k", "2048x2048"], ["16:9", "1k", "1536x864"], ["16:9", "2k", "2048x1152"],
        ["9:16", "2k", "1152x2048"], ["3:1", "1k", "1920x640"], ["21:9", "2k", "2688x1152"], ["1:1", "4k", "2880x2880"], ["16:9", "4k", "3840x2160"], ["4:5", "4k", "2576x3216"],
    ]) {
        assert.equal(context.tudouGpt26Size(config({ size, quality })), expected, `${size} ${quality}`);
    }
    for (const sizes of Object.values(context.TUDOU_GPT26_PIXELS)) {
        for (const value of sizes) {
            const [w, h] = value.split("x").map(Number);
            assert.equal(w % 16 + h % 16, 0, value);
            assert.ok(Math.max(w, h) / Math.min(w, h) <= 3, value);
            assert.ok(Math.max(w, h) <= 3840 && w * h <= 3840 * 2160, value);
        }
    }
    assert.deepEqual(Object.keys(context.TUDOU_GPT26_PIXELS).sort(), [...context.TUDOU_GPT_ASPECT_RATIOS].sort());
});

test("text-to-image posts to /images/generations with the variant model, size and quality", async () => {
    const { context, calls } = runtime();
    const images = await context.submitTudouGptImages(config({ size: "16:9", quality: "2k", gptImageQuality: "high", tudouGpt25Variant: "sunburst" }), "lake", [], 1);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://api.ai-tudou.net/v1/images/generations");
    assert.equal(calls[0].posted.url, calls[0].url);
    assert.deepEqual(JSON.parse(JSON.stringify(calls[0].posted.body)), { model: "gpt-image-2.6-sunburst", prompt: "lake", size: "2048x1152", quality: "high", n: 1 });
    assert.equal(images[0].dataUrl, "https://www.vinsen.top/api/tudou-image?url=" + encodeURIComponent("https://pub-1319f2cb116e4b0a8d8ce240527c6332.r2.dev/image-hub/2026/11/18/a.png"));
});

test("image-to-image posts the reference URLs in `image` to /images/edits", async () => {
    const { context, calls } = runtime();
    const refs = ["https://res.cloudinary.com/x/image/upload/a.png", "https://res.cloudinary.com/x/image/upload/b.png"];
    await context.submitTudouGptImages(config({ size: "1:1", quality: "1k" }), "mix", refs, 1);
    assert.equal(calls[0].url, "https://api.ai-tudou.net/v1/images/edits");
    assert.deepEqual(JSON.parse(JSON.stringify(calls[0].posted.body)), { model: "gpt-image-2.6-flare", prompt: "mix", size: "1024x1024", quality: "medium", n: 1, image: refs });
});

test("only 土豆's R2 result links go through our server; others are untouched", () => {
    const r2 = "https://pub-fc1a727799c14c8ca8d73d1229fe0f96.r2.dev/image-hub/2026/11/18/d.png";
    assert.equal(runtime().context.tudouResultUrl(r2), `https://www.vinsen.top/api/tudou-image?url=${encodeURIComponent(r2)}`);
    assert.equal(runtime("vinsen0110.github.io").context.tudouResultUrl(r2), `https://www.vinsen.top/api/tudou-image?url=${encodeURIComponent(r2)}`);
    assert.equal(runtime("127.0.0.1").context.tudouResultUrl(r2).startsWith("https://127.0.0.1/api/tudou-image?url="), true);
    for (const other of ["https://mg.ai-tudou.net/a.png", "https://evil.r2.dev/a.png", "data:image/png;base64,AA=="]) {
        assert.equal(runtime().context.tudouResultUrl(other), other);
    }
});

test("the relay prices the synchronous request under the new model name", () => {
    for (const path of ["generations", "edits"]) {
        const d = describeRequest(new URL(`https://api.ai-tudou.net/v1/images/${path}`), { model: "gpt-image-2.6-flare", prompt: "x", size: "2048x2048", quality: "high", n: 1 });
        assert.deepEqual(d, { model: "gpt-image-2.6-flare", spec: "high", count: 1 });
    }
});

test("the image proxy accepts only 土豆's R2 image-hub links besides ai-tudou.net", async () => {
    const server = await readFile(new URL("../local-preview-server.mjs", import.meta.url), "utf8");
    assert.match(server, /\/\^pub-\[0-9a-f\]\{32\}\\\.r2\\\.dev\$\/\.test\(target\.hostname\) && target\.pathname\.startsWith\("\/image-hub\/"\)/);
    const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
    assert.match(html, /\/\^pub-\[0-9a-f\]\{32\}\\\.r2\\\.dev\$\/\.test\(target\.hostname\) && target\.pathname\.indexOf\("\/image-hub\/"\) === 0/);
});
