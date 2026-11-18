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
    assert.deepEqual(GRSAI_SITE_MODELS, ["nano-banana-2.1", "nano-banana-pro", "gpt-image-2.6"]);
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
    assert.match(bundle, /g\?\.provider==="grsai"\?y\.jsxs\("section",\{key:"balance-section:"/);
    assert.match(bundle, /children:"Grsai \\u8D26\\u6237\\u4F59\\u989D"/);
    assert.match(bundle, /\["gpt-image-2","gpt-image-2-vip","gpt-image-2\.5","gpt-image-2\.6"\]/);
    assert.match(bundle, /s&&\(n==="nano-banana-pro"\|\|n==="nano-banana-2\.1"\|\|n==="gpt-image-2\.6"\)\?grsaiImagePrice\(e\)/);
    assert.match(bundle, /s&&\(n==="gpt-image-2"\|\|n==="gpt-image-2-vip"\)\?\.2/);
    assert.match(bundle, /pr\(t\)==="gpt-image-2-vip"\?"gpt-image-2"/);
    assert.match(bundle, /fetchGrsaiApiKeyCredits\(K\).*De\(le\/1e4\)/);
    assert.match(bundle, /fetchGrsaiAccountCredits\(le,K\).*Rt\(Mt\/1e4\)/);
    assert.match(bundle, /K=\(N\.grsaiTotalBalanceToken\|\|""\)\.trim\(\)/);
    assert.match(bundle, /value:a\.grsaiTotalBalanceToken\|\|""/);
    assert.match(bundle, /onChange:\$=>i\("grsaiTotalBalanceToken",\$\.target\.value\)/);
    assert.doesNotMatch(bundle, /totalBalanceToken|totalBalanceUserId/);
});

test("Grsai GPT image 2.6 sends Flare or Sunburst with a pixel size and the chosen quality", () => {
    const config = (patch) => ({ model: "grsai::gpt-image-2.6", quality: "2k", size: "16:9", ...patch });
    const flare = grsaiImageRequestSpec(config({ gptImageQuality: "xhigh" }), " draw ", []);
    assert.equal(flare.endpoint, "/v1/api/generate");
    assert.deepEqual(flare.body, { model: "gpt-image-2.6-flare", prompt: "draw", images: [], aspectRatio: "2048x1152", replyType: "async", quality: "high" });
    const sunburst = grsaiImageRequestSpec(config({ quality: "4k", size: "3:4", tudouGpt25Variant: "sunburst", gptImageQuality: "max" }), "edit", ["https://example.com/ref.png"]);
    assert.deepEqual(sunburst.body, { model: "gpt-image-2.6-sunburst", prompt: "edit", images: ["https://example.com/ref.png"], aspectRatio: "2448x3264", replyType: "async", quality: "high" });
    assert.equal(grsaiImageRequestSpec(config({ gptImageQuality: "low" }), "x").body.quality, "low");
    assert.equal(grsaiImageRequestSpec(config({ size: "auto", gptImageQuality: "ultra" }), "x").body.aspectRatio, "auto");
    assert.equal(grsaiImageRequestSpec(config({ gptImageQuality: "ultra" }), "x").body.quality, "auto");
    // 2,000 / 2,400 credits per call at any resolution or quality (display convention: 10,000 credits = 1).
    for (const quality of ["1k", "2k", "4k"]) {
        assert.equal(grsaiImagePrice(config({ quality })), 0.2);
        assert.equal(grsaiImagePrice(config({ quality, tudouGpt25Variant: "sunburst", gptImageQuality: "max" })), 0.24);
    }
});

test("Grsai GPT image 2.6 has a catalog price per variant and resolution and is open to users", async () => {
    const { priceCatalog } = await import("../account/catalog.js");
    const { isAdminOnlyModel } = await import("../account/relay.js");
    const rows = priceCatalog().filter((r) => r.channel === "grsai" && r.model.startsWith("gpt-image-2.6"));
    assert.deepEqual(rows.map(({ label, model, spec, cost }) => ({ label, model, spec, cost })), [
        ...["1k", "2k", "4k"].map((spec) => ({ label: "GPT Image 2.6 · Flare", model: "gpt-image-2.6-flare", spec, cost: 0.2 })),
        ...["1k", "2k", "4k"].map((spec) => ({ label: "GPT Image 2.6 · Sunburst", model: "gpt-image-2.6-sunburst", spec, cost: 0.24 })),
    ]);
    // Same names as Mart's official models, which stay admin-only.
    assert.equal(isAdminOnlyModel("grsai", "gpt-image-2.6-flare"), false);
    assert.equal(isAdminOnlyModel("apimart", "gpt-image-2.6-flare"), true);
    assert.equal(isAdminOnlyModel("runninghub", "rhart-image-g-2.5-official-token"), true);
});

test("Grsai GPT image 2.6 shows its variant and six qualities in the canvas", () => {
    assert.match(bundle, /isGrsaiGpt26=pr\(t\.model\)==="gpt-image-2\.6"&&isGrsaiSite\(u\)/);
    assert.match(bundle, /isGrsaiGpt26\?grsaiGptQuality\(t\):tudouQuality\(t\)/);
    assert.match(bundle, /isGrsaiGpt26\?y\.jsxs\(y\.Fragment,\{children:\[y\.jsx\(n\$,\{value:tudouGpt25Variant\(t\),items:APIMART_GPT25_VARIANT_OPTIONS,[^]*?onChange:C=>a\(e\.id,\{tudouGpt25Variant:C\}\)\}\),y\.jsx\(n\$,\{value:w,items:GRSAI_GPT26_QUALITY_OPTIONS,/);
    assert.match(bundle, /gptQualityOptions=isGrsaiGpt26\?GRSAI_GPT26_QUALITY_OPTIONS:GPT_IMAGE_QUALITY_OPTIONS/);
    assert.ok(bundle.includes(`GRSAI_GPT26_QUALITY_OPTIONS=[{value:"auto",label:"Auto"},{value:"low",label:"Low"},{value:"medium",label:"Medium"},{value:"high",label:"High"}]`));
});

test("Grsai GPT image 2.6 is charged by the resolution its pixel size belongs to", async () => {
    const { describeRequest } = await import("../account/describe.js");
    const { lwSellPrice } = await import("../account-pricing.js");
    const target = new URL(`${GRSAI_ORIGIN}/v1/api/generate`);
    const ratios = ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "5:4", "4:5", "21:9", "9:21", "1:3", "3:1", "2:1", "1:2"];
    for (const size of ratios) for (const quality of ["1k", "2k", "4k"]) {
        const { body } = grsaiImageRequestSpec({ model: "grsai::gpt-image-2.6", size, quality, gptImageQuality: "high" }, "x");
        // 1:3 and 3:1 have one size for both 2K and 4K, so they cost 2K.
        const expected = quality === "4k" && (size === "1:3" || size === "3:1") ? "2k" : quality;
        assert.equal(describeRequest(target, body).spec, `${expected}/high`, `${size} ${quality}`);
    }
    const auto = grsaiImageRequestSpec({ model: "grsai::gpt-image-2.6", size: "auto", quality: "4k", tudouGpt25Variant: "sunburst" }, "x").body;
    assert.deepEqual(describeRequest(target, auto), { model: "gpt-image-2.6-sunburst", spec: "1k/auto", count: 1 });
    // Ratio names (RunningHub) and Grsai Nano Banana keep their old specs.
    assert.equal(describeRequest(target, { model: "nano-banana-pro", aspectRatio: "16:9", imageSize: "2K" }).spec, "2k");
    assert.equal(describeRequest(target, { model: "rh", aspectRatio: "16:9" }).spec, "");
    const prices = [["1k", 0.3], ["2k", 0.4], ["4k", 0.5]].map(([spec, price]) => ({ channel: "grsai", model: "gpt-image-2.6-flare", spec, price }));
    const sell = (patch) => lwSellPrice({ model: "grsai::gpt-image-2.6", size: "16:9", ...patch }, { provider: "grsai" }, prices);
    assert.equal(sell({ quality: "1k" }), 0.3);
    assert.equal(sell({ quality: "2k", gptImageQuality: "high" }), 0.4);
    assert.equal(sell({ quality: "4k" }), 0.5);
    assert.equal(sell({ quality: "4k", size: "auto" }), 0.3);
});
