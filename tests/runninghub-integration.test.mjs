import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
    RUNNINGHUB_IMAGE_MODELS,
    RUNNINGHUB_LLM_ORIGIN,
    RUNNINGHUB_ORIGIN,
    RUNNINGHUB_SITE_MODELS,
    RUNNINGHUB_TEXT_MODELS,
    fetchRunningHubAccount,
    runRunningHubImageGeneration,
    runningHubErrorMessage,
    runningHubImagePrice,
    runningHubImageRequestSpec,
    runningHubResolution,
    uploadRunningHubReferenceBlob,
} from "../runninghub-api.js";


const bundle = await readFile(new URL("../assets/index-B2KJ37fm.js", import.meta.url), "utf8");
const indexHtml = await readFile(new URL("../index.html", import.meta.url), "utf8");

function jsonResponse(payload, status = 200) {
    return new Response(JSON.stringify(payload), {
        status,
        headers: { "Content-Type": "application/json" },
    });
}

test("RH Nano Banana Pro request mapping keeps 4K lowercase", () => {
    const text = runningHubImageRequestSpec({ quality: "4K", size: "auto" }, "test");
    assert.equal(text.endpoint, "/openapi/v2/rhart-image-n-pro/text-to-image");
    assert.deepEqual(text.body, {
        prompt: "test",
        resolution: "4k",
    });

    const edit = runningHubImageRequestSpec(
        { quality: "4K", size: "auto" },
        "edit",
        ["https://example.com/reference.png"],
    );
    assert.equal(edit.endpoint, "/openapi/v2/rhart-image-n-pro/edit");
    assert.deepEqual(edit.body, {
        imageUrls: ["https://example.com/reference.png"],
        prompt: "edit",
        resolution: "4k",
    });
});

test("RH exposes image and text models and maps Auto to the provider's legal 1K value", () => {
    assert.deepEqual(RUNNINGHUB_SITE_MODELS, [
        "nano-banana-pro",
        "google/gemini-3.8-flash",
    ]);
    assert.deepEqual(RUNNINGHUB_IMAGE_MODELS, ["nano-banana-pro"]);
    assert.deepEqual(RUNNINGHUB_TEXT_MODELS, ["google/gemini-3.8-flash"]);
    assert.equal(RUNNINGHUB_LLM_ORIGIN, "https://llm.runninghub.ai");
    assert.equal(runningHubResolution({ quality: "auto" }), "1k");

    const request = runningHubImageRequestSpec(
        { model: "nano-banana-pro", quality: "auto", size: "auto" },
        "draw",
    );
    assert.equal(request.body.resolution, "1k");
    assert.equal(request.body.aspectRatio, undefined);
});

test("RH Nano Banana Pro prices Auto, 1K and 2K at $0.06 and 4K at $0.07", () => {
    for (const quality of ["auto", "1k", "2k"]) {
        assert.equal(runningHubImagePrice({ model: "nano-banana-pro", quality }, false), 0.06);
        assert.equal(runningHubImagePrice({ model: "nano-banana-pro", quality }, true), 0.06);
    }
    assert.equal(runningHubImagePrice({ model: "nano-banana-pro", quality: "4k" }, false), 0.07);
    assert.equal(runningHubImagePrice({ model: "nano-banana-pro", quality: "4k" }, true), 0.07);
});

test("RH GPT Image 2 routes text and reference generations to stable official endpoints", () => {
    const text = runningHubImageRequestSpec({
        model: "gpt-image-2",
        quality: "2K",
        size: "1:2",
        gptImageQuality: "low",
    }, "draw");
    assert.equal(text.endpoint, "/openapi/v2/rhart-image-g-2-official/text-to-image");
    assert.deepEqual(text.body, {
        prompt: "draw",
        aspectRatio: "1:2",
        resolution: "2k",
        quality: "low",
    });

    const edit = runningHubImageRequestSpec({
        model: "runninghub::gpt-image-2",
        quality: "4K",
        size: "9:21",
        gptImageQuality: "high",
    }, "edit", ["https://example.com/reference.png"]);
    assert.equal(edit.endpoint, "/openapi/v2/rhart-image-g-2-official/image-to-image");
    assert.deepEqual(edit.body, {
        imageUrls: ["https://example.com/reference.png"],
        prompt: "edit",
        aspectRatio: "9:21",
        resolution: "4k",
        quality: "high",
    });
});

test("RH GPT Image 2 prices match text-to-image and image-to-image tables", () => {
    const textPrices = {
        low: { "1k": 0.009, "2k": 0.018, "4k": 0.027 },
        medium: { "1k": 0.054, "2k": 0.108, "4k": 0.162 },
        high: { "1k": 0.198, "2k": 0.396, "4k": 0.594 },
    };
    const referencePrices = {
        low: { "1k": 0.027, "2k": 0.054, "4k": 0.081 },
        medium: { "1k": 0.054, "2k": 0.108, "4k": 0.162 },
        high: { "1k": 0.198, "2k": 0.396, "4k": 0.594 },
    };

    for (const [quality, resolutions] of Object.entries(textPrices)) {
        for (const [resolution, price] of Object.entries(resolutions)) {
            const config = { model: "gpt-image-2", quality: resolution, gptImageQuality: quality };
            assert.equal(runningHubImagePrice(config, false), price);
            assert.equal(runningHubImagePrice(config, true), referencePrices[quality][resolution]);
        }
    }
});

test("RH submits one generation task and only polls that task", async () => {
    const requests = [];
    const responses = [
        { taskId: "task-1", status: "RUNNING", results: null },
        { taskId: "task-1", status: "RUNNING", results: null },
        {
            taskId: "task-1",
            status: "SUCCESS",
            results: [
                { url: "https://example.com/output-1.png" },
                { url: "https://example.com/output-2.png" },
            ],
        },
    ];
    let clock = 0;
    const fetchImpl = async (url, init) => {
        requests.push({ url: String(url), init });
        return jsonResponse(responses.shift());
    };

    const urls = await runRunningHubImageGeneration(
        { apiKey: "rh-key", quality: "4k", size: "16:9" },
        "draw",
        [],
        {
            fetchImpl,
            sleep: async () => {},
            now: () => (clock += 1_000),
        },
    );

    assert.deepEqual(urls, [
        "https://example.com/output-1.png",
        "https://example.com/output-2.png",
    ]);
    assert.equal(
        requests.filter(({ url }) => url.endsWith("/text-to-image")).length,
        1,
        "the billable create endpoint must be called exactly once",
    );
    assert.equal(requests.filter(({ url }) => url.endsWith("/openapi/v2/query")).length, 2);
    assert.equal(requests[0].init.headers.Authorization, "Bearer rh-key");
    assert.deepEqual(JSON.parse(requests[0].init.body), {
        prompt: "draw",
        aspectRatio: "16:9",
        resolution: "4k",
    });
    assert.deepEqual(JSON.parse(requests[1].init.body), { taskId: "task-1" });
});

test("RH failures and Enterprise-Shared key errors are surfaced clearly", async () => {
    await assert.rejects(
        runRunningHubImageGeneration(
            { apiKey: "member-key" },
            "draw",
            [],
            { fetchImpl: async () => jsonResponse({ code: 1014, message: "invalid api type" }, 400) },
        ),
        /Enterprise-Shared API Key/,
    );

    await assert.rejects(
        runRunningHubImageGeneration(
            { apiKey: "rh-key" },
            "draw",
            [],
            {
                fetchImpl: async () => jsonResponse({
                    taskId: "failed-task",
                    status: "FAILED",
                    errorCode: "1501",
                    errorMessage: "content rejected",
                }),
            },
        ),
        /RH 内容审核未通过/,
    );
    assert.match(runningHubErrorMessage({ code: 1014 }), /Enterprise-Shared API Key/);
});

test("RH reference upload uses the native multipart endpoint", async () => {
    const calls = [];
    const source = new Blob([Uint8Array.from([1, 2, 3])], { type: "image/png" });
    const url = await uploadRunningHubReferenceBlob(
        { apiKey: "rh-key" },
        source,
        {
            fetchImpl: async (target, init) => {
                calls.push({ target: String(target), init });
                return jsonResponse({
                    code: 0,
                    data: { download_url: "https://www.runninghub.ai/view/reference.png" },
                });
            },
        },
    );

    assert.equal(url, "https://www.runninghub.ai/view/reference.png");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].target, `${RUNNINGHUB_ORIGIN}/openapi/v2/media/upload/binary`);
    assert.equal(calls[0].init.headers.Authorization, "Bearer rh-key");
    assert.ok(calls[0].init.body instanceof FormData);
    assert.equal(calls[0].init.body.get("file").type, "image/png");
    assert.equal(calls[0].init.body.has("image"), false);
    assert.doesNotMatch(calls[0].target, /imgbb|upload\/file/);
});

test("RH reference upload rejects business errors returned with HTTP 200", async () => {
    const source = new Blob([Uint8Array.from([1, 2, 3])], { type: "image/png" });
    await assert.rejects(
        uploadRunningHubReferenceBlob(
            { apiKey: "invalid-key" },
            source,
            { fetchImpl: async () => jsonResponse({ code: 401, message: "ApiKey verification failed" }) },
        ),
        /RH API Key 无效或已被禁用/,
    );
});

test("RH account query sends both Bearer auth and the key body", async () => {
    const calls = [];
    const account = await fetchRunningHubAccount(
        { apiKey: "rh-key" },
        {
            fetchImpl: async (url, init) => {
                calls.push({ url: String(url), init });
                return jsonResponse({
                    code: 0,
                    data: {
                        remainMoney: "12.50",
                        currency: "USD",
                        remainCoins: 350,
                        currentTaskCounts: 1,
                        apiType: "ENTERPRISE_SHARED",
                    },
                });
            },
        },
    );

    assert.equal(calls[0].url, `${RUNNINGHUB_ORIGIN}/uc/openapi/accountStatus`);
    assert.equal(calls[0].init.headers.Authorization, "Bearer rh-key");
    assert.deepEqual(JSON.parse(calls[0].init.body), { apikey: "rh-key" });
    assert.equal(account.apiType, "ENTERPRISE_SHARED");
});

test("RH is a fully isolated third site in the compiled app", () => {
    assert.match(bundle, /RUNNINGHUB_SITE_NAME/);
    assert.match(bundle, /provider:"runninghub",models:RUNNINGHUB_SITE_MODELS/);
    assert.match(bundle, /apiKeys:i\?\.apiKeys,activeKeyId:i\?\.activeKeyId/);
    assert.match(bundle, /siteImageModelNames\(e\)\{return e===RUNNINGHUB_SITE_ID\?RUNNINGHUB_IMAGE_MODELS/);
    assert.match(bundle, /siteTextModelNames\(e\)\{return e===RUNNINGHUB_SITE_ID\?RUNNINGHUB_TEXT_MODELS/);
    assert.match(bundle, /textSiteId:d\.textSiteId,textModel:d\.textModel/);
    assert.match(bundle, /isRunningHubSite\(r\).*runRunningHubImageGeneration\(r,t,\[\]/s);
    assert.match(
        bundle,
        /if\(isRunningHubSite\(a\)\).*runningHubReferenceSource\(a,h,o\?\.signal\).*runRunningHubImageGeneration/s,
        "RH image-to-image must upload references and use the native async generator",
    );
    assert.match(
        bundle,
        /function bd\(e,t\)\{const n=\$S\(t\).*o=\(n\?e\.channels\.find\(a=>a\.id===n\.channelId\):null\)\|\|activeSiteChannel\(e\)/,
        "a namespaced model must resolve its own provider channel before the active canvas site",
    );
    assert.match(bundle, /runningHubReferenceSource/);
    assert.match(bundle, /runRunningHubImageGeneration/);
    assert.doesNotMatch(bundle, /n\.slice\(0,10\)/);
    assert.match(bundle, /RUNNINGHUB_TEXT_MODELS/);
    assert.match(bundle, /if\(isRunningHubSite\(K\)\)\{const Q=await fetchRunningHubAccount\(K\)/);
    assert.match(bundle, /Ba=!isTudouSite\(balanceSite\)&&!isRunningHubSite\(balanceSite\)/);
    assert.match(bundle, /isRunningHubSite\(balanceSite\)\?`\$\{qke\(be\)\} \$`/);
    assert.doesNotMatch(bundle, /rhBalanceCurrency|setRhBalanceCurrency/);
    assert.match(bundle, /if\(isTudouSite\(le\)\|\|isRunningHubSite\(le\)\|\|le\.apiKey==="lw-balance"\)\{Wt\(!1\),Rt\(null\),Lt\(""\);return\}/);
    assert.doesNotMatch(bundle, /queryRunningHubAccount|rhAccountLoading|rh-account-/);
    assert.match(bundle, /runningHubImagePrice\(e,t\)/, "RH price must be visible");
    assert.match(bundle, /pke\(h,n\.imageCount>0\)/, "config nodes must use reference pricing");
    assert.match(bundle, /pke\(w,i\.some\(z=>z\.active&&z\.kind==="image"&&z\.previewUrl\)\)/);
    assert.match(bundle, /\["tudou","runninghub","grsai","apimart"\]\.includes\(g\?\.provider\)/);
    assert.match(bundle, /u=Array\.isArray\(t\.channels\)\?bd\(t,t\.model\):t/, "the active channel must be resolved");
    assert.match(bundle, /isRunningHubSite\(u\)/, "RH GPT controls must appear on canvas");
    assert.doesNotMatch(bundle, /if\(r\)return null;const o=/);
    assert.doesNotMatch(indexHtml, /\.rh-account-/);
    assert.match(indexHtml, /\.rh-text-model-empty/);
});

test("RH accepts at most ten reference URLs", async () => {
    await assert.rejects(
        runRunningHubImageGeneration(
            { apiKey: "rh-key" },
            "edit",
            Array.from({ length: 11 }, (_, index) => `https://example.com/${index}.png`),
        ),
        /最多支持 10 张参考图/,
    );
});
