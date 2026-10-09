import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
    GRSAI_ORIGIN,
    GRSAI_SITE_MODELS,
    grsaiImagePrice,
    fetchGrsaiAccountCredits,
    fetchGrsaiApiKeyCredits,
    grsaiImageRequestSpec,
    parseGrsaiTask,
    runGrsaiImageGeneration,
} from "../grsai-api.js";

const bundle = await readFile(new URL("../assets/index-B2KJ37fm.js", import.meta.url), "utf8");

test("builds asynchronous Nano Banana Pro request with shared canvas parameters", () => {
    const spec = grsaiImageRequestSpec({ model: "nano-banana-pro", size: "16:9", quality: "4k" }, "make a poster", ["https://imgbb.com/ref.png"]);
    assert.equal(spec.endpoint, "/v1/api/generate");
    assert.deepEqual(spec.body, {
        model: "nano-banana-pro",
        prompt: "make a poster",
        images: ["https://imgbb.com/ref.png"],
        aspectRatio: "16:9",
        replyType: "async",
        imageSize: "4K",
    });
});

test("routes Nano Banana 2.1 explicitly and preserves display credit conversion", () => {
    assert.deepEqual(GRSAI_SITE_MODELS, ["nano-banana-2.1", "nano-banana-pro"]);
    for (const quality of ["1k", "2k", "4k"]) {
        for (const size of ["auto", "1:1", "1:4", "4:1", "1:8", "8:1"]) {
            const config = { model: "grsai::nano-banana-2.1", quality, size };
            const spec = grsaiImageRequestSpec(config, " draw ", ["https://example.com/ref.png"]);
            assert.equal(spec.endpoint, "/v1/api/generate");
            assert.deepEqual(spec.body, {
                model: "nano-banana-2.1", prompt: "draw", images: ["https://example.com/ref.png"],
                aspectRatio: size, replyType: "async", imageSize: quality.toUpperCase(),
            });
            assert.equal(grsaiImagePrice(config), 0.12);
        }
    }
    assert.equal(grsaiImagePrice({ model: "nano-banana-pro" }), 0.18);
    assert.equal(grsaiImagePrice({ model: "gpt-image-2-vip" }), 0.2);
    assert.throws(() => grsaiImageRequestSpec({ model: "unknown-model" }, "draw"), /不支持/);
});

test("maps GPT Image VIP ratio and resolution to pixel size", () => {
    const spec = grsaiImageRequestSpec({ model: "default::gpt-image-2-vip", size: "16:9", quality: "4k" }, "draw it");
    assert.equal(spec.body.model, "gpt-image-2-vip");
    assert.equal(spec.body.aspectRatio, "3840x2160");
    assert.equal(spec.body.replyType, "async");
    assert.equal(spec.body.imageSize, undefined);
});

test("parses async result states and polls until success", async () => {
    assert.deepEqual(parseGrsaiTask({ data: { id: "task-1", status: "running" } }), { status: "pending", taskId: "task-1", progress: undefined });
    assert.deepEqual(parseGrsaiTask({ data: { id: "task-1", status: "violation", message: "blocked" } }), { status: "failed", taskId: "task-1", error: "blocked" });
    const calls = [];
    const urls = await runGrsaiImageGeneration(
        { baseUrl: GRSAI_ORIGIN, apiKey: "sk-test", model: "nano-banana-2.1", size: "1:1", quality: "1k" },
        "draw it",
        [],
        {
            sleep: async () => {},
            fetchImpl: async (url, init) => {
                calls.push({ url, init });
                const payload = calls.length === 1
                    ? { data: { id: "task-1", status: "running" } }
                    : { data: { id: "task-1", status: "succeeded", results: [{ url: "https://cdn.example/result.png" }] } };
                return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
            },
        },
    );
    assert.deepEqual(urls, ["https://cdn.example/result.png"]);
    assert.equal(calls[0].url, `${GRSAI_ORIGIN}/v1/api/generate`);
    assert.equal(calls[0].init.method, "POST");
    assert.equal(JSON.parse(calls[0].init.body).model, "nano-banana-2.1");
    assert.equal(calls.filter(call => call.init.method === "POST").length, 1);
    assert.equal(calls[1].url, `${GRSAI_ORIGIN}/v1/api/result?id=task-1`);
    assert.equal(calls[1].init.method, "GET");
});

test("uses the documented API Key and account credit endpoints", async () => {
    const calls = [];
    const fetchImpl = async (url, init) => {
        calls.push({ url, init, body: JSON.parse(init.body) });
        return new Response(JSON.stringify({ success: true, data: { credits: 1234 } }), { status: 200 });
    };
    assert.equal(await fetchGrsaiApiKeyCredits({ baseUrl: GRSAI_ORIGIN, apiKey: "sk-test" }, { fetchImpl }), 1234);
    assert.equal(await fetchGrsaiAccountCredits({ baseUrl: GRSAI_ORIGIN, apiKey: "sk-test" }, "account-token", { fetchImpl }), 1234);
    assert.equal(calls[0].url, `${GRSAI_ORIGIN}/client/openapi/getAPIKeyCredits`);
    assert.deepEqual(calls[0].body, { apiKey: "sk-test" });
    assert.equal(calls[1].url, `${GRSAI_ORIGIN}/client/openapi/getCredits`);
    assert.deepEqual(calls[1].body, { token: "account-token" });
});

test("bundle keeps Grsai generation, balance, and settings branches", () => {
    assert.match(bundle, /isGrsaiSite\(K\).*fetchGrsaiApiKeyCredits/);
    assert.match(bundle, /isGrsaiSite\(le\).*fetchGrsaiAccountCredits/);
    assert.match(bundle, /g\?\.provider==="apilio"\|\|g\?\.provider==="grsai"/);
    assert.match(bundle, /g\?\.provider==="grsai"\?"Grsai/);
    assert.match(bundle, /\["gpt-image-2","gpt-image-2-vip","gpt-image-2\.5"\]/);
    assert.match(bundle, /s&&\(n==="nano-banana-pro"\|\|n==="nano-banana-2\.1"\)\?grsaiImagePrice\(e\)/);
    assert.match(bundle, /s&&\(n==="gpt-image-2"\|\|n==="gpt-image-2-vip"\)\?\.2/);
    assert.match(bundle, /pr\(t\)==="gpt-image-2-vip"\?"gpt-image-2"/);
    assert.match(bundle, /fetchGrsaiApiKeyCredits\(K\).*De\(le\/1e4\)/);
    assert.match(bundle, /fetchGrsaiAccountCredits\(le,K\).*Rt\(Mt\/1e4\)/);
    assert.match(bundle, /K=\(isGrsaiSite\(le\)\?N\.grsaiTotalBalanceToken\|\|"":N\.totalBalanceToken\|\|""\)\.trim\(\)/);
    assert.match(bundle, /value:a\.grsaiTotalBalanceToken\|\|""/);
    assert.match(bundle, /onChange:\$=>i\("grsaiTotalBalanceToken",\$\.target\.value\)/);
    assert.match(bundle, /value:a\.totalBalanceToken/);
    assert.match(bundle, /onChange:\$=>i\("totalBalanceToken",\$\.target\.value\)/);
});
