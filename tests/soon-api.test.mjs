import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
    SOON_MAX_REFERENCES,
    SOON_ORIGIN,
    SOON_SITE_MODELS,
    SOON_TEXT_MODELS,
    SOON_UPLOAD_MAX_BYTES,
    SOON_UPLOAD_URL,
    runSoonImageGeneration,
    parseSoonTask,
    soonImagePrice,
    soonImageRequestSpec,
    uploadSoonReferenceBlob,
} from "../soon-api.js";

const bundle = await readFile(new URL("../assets/index-B2KJ37fm.js", import.meta.url), "utf8");
const config = { provider: "soon", baseUrl: SOON_ORIGIN, apiKey: "sk-soon_test", model: "soon::nano-banana-pro" };
const json = (body, status = 200) => new Response(JSON.stringify(body), {
    status, headers: { "Content-Type": "application/json" },
});

test("Soon stays image-only, with RH-equivalent canvas model and 1:1 price units", () => {
    assert.deepEqual(SOON_SITE_MODELS, ["nano-banana-pro"]);
    assert.deepEqual(SOON_TEXT_MODELS, []);
    for (const [quality, resolution, price] of [
        ["auto", "1K", 0.24], ["1K", "1K", 0.24],
        ["2K", "2K", 0.24], ["4K", "4K", 0.33],
    ]) {
        const variant = { ...config, quality, size: "16:9" };
        assert.equal(soonImagePrice(variant), price);
        assert.deepEqual(soonImageRequestSpec(variant, " draw ")?.body, {
            model: "nano-banana-pro", prompt: "draw", n: 1, aspect_ratio: "16:9",
            image_size: resolution, response_format: "url",
        });
    }
    const urls = ["https://example.com/a.png", "https://example.com/b.jpg"];
    assert.deepEqual(soonImageRequestSpec(config, "edit", urls).body.images, urls);
    assert.throws(() => soonImageRequestSpec(config, "edit", ["not a URL"]), /HTTPS/);
    assert.throws(() => soonImageRequestSpec(config, "edit", ["http://example.com/a.png"]), /HTTPS/);
    assert.throws(() => soonImageRequestSpec(config, "edit", Array(SOON_MAX_REFERENCES + 1).fill(urls[0])), /14/);
    assert.throws(() => soonImageRequestSpec({ ...config, model: "soon::gpt-image-2.5" }, "draw"), /只接入/);
});

test("Soon submission is asynchronous, polls the same task, and never retries billing POST", async () => {
    const calls = [];
    const progress = [];
    const replies = [
        json({ data: { task_id: "task-1", status: "PENDING" } }),
        json({ error: { message: "temporary" } }, 503),
        json({ data: { task_id: "task-1", status: "IN_PROGRESS", progress: 42 } }),
        json({ data: { task_id: "task-1", status: "SUCCESS", data: { data: [
            { url: "https://example.com/finished.png" },
        ] } } }),
    ];
    const urls = await runSoonImageGeneration(config, "draw", [], {
        fetchImpl: async (url, init) => {
            calls.push({ url, init });
            return replies.shift();
        },
        sleep: async () => {},
        onProgress: state => progress.push(state),
    });
    assert.deepEqual(urls, ["https://example.com/finished.png"]);
    assert.equal(calls.filter(call => call.init.method === "POST").length, 1);
    assert.deepEqual(progress[0], { stage: "generating", progress: 0 });
    assert.equal(calls[0].url, `${SOON_ORIGIN}/v1/images/generations?async=true`);
    assert.equal(calls[0].init.headers["x-studio-channel-group"], "default");
    assert.equal(calls[0].init.headers["x-studio-request-model"], "nano-banana-pro");
    assert.deepEqual(calls.slice(1).map(call => call.url),
        Array(3).fill(`${SOON_ORIGIN}/v1/images/tasks/task-1?language=zh`));
    assert.ok(progress.some(state => state.progress === 42));
});

test("Soon changes the canvas stage before the single billable request returns", async () => {
    const events = [];
    let submissions = 0;
    const output = await runSoonImageGeneration(config, "draw", [], {
        onProgress: event => events.push(event),
        fetchImpl: async (_url, init) => {
            assert.equal(init.method, "POST");
            assert.deepEqual(events[0], { stage: "generating", progress: 0 });
            submissions++;
            return json({ data: { status: "SUCCESS", data: { data: [
                { url: "https://example.com/result.png" },
            ] } } });
        },
    });
    assert.deepEqual(output, ["https://example.com/result.png"]);
    assert.equal(submissions, 1);
});

test("Soon image editing switches stage before submission and polls only its returned task", async () => {
    const references = ["https://example.com/reference-a.png", "https://example.com/reference-b.png"];
    const calls = [];
    const stages = [];
    const output = await runSoonImageGeneration(config, "edit", references, {
        onProgress: event => stages.push(event.stage),
        sleep: async () => {},
        fetchImpl: async (url, init) => {
            calls.push({ url, method: init.method });
            if (init.method === "POST") {
                assert.equal(stages[0], "generating");
                assert.deepEqual(JSON.parse(init.body).images, references);
                return json({ data: { task_id: "edit-task", status: "PENDING" } });
            }
            return calls.length === 2
                ? json({ data: { task_id: "edit-task", status: "IN_PROGRESS" } })
                : json({ data: { task_id: "edit-task", status: "SUCCESS",
                    data: [{ url: "https://example.com/edited.png" }] } });
        },
    });
    assert.deepEqual(output, ["https://example.com/edited.png"]);
    assert.deepEqual(calls.map(call => call.method), ["POST", "GET", "GET"]);
    assert.deepEqual(calls.slice(1).map(call => call.url),
        Array(2).fill(`${SOON_ORIGIN}/v1/images/tasks/edit-task?language=zh`));
});

test("Soon rejects failed submissions and unknown tasks without paying twice", async () => {
    let requests = 0;
    await assert.rejects(runSoonImageGeneration(config, "draw", [], {
        fetchImpl: async () => { requests++; return json({ error: { message: "invalid key" } }, 401); },
    }), /invalid key/);
    assert.equal(requests, 1);
    await assert.rejects(runSoonImageGeneration(config, "draw", [], {
        fetchImpl: async () => json({ data: { status: "PENDING" } }),
    }), /task_id/);
    await assert.rejects(runSoonImageGeneration(config, "draw", [], {
        fetchImpl: async () => json({ data: { task_id: "x", status: "FAILED", fail_reason: "bad prompt" } }),
    }), error => {
        assert.match(error.message, /bad prompt.*任务 ID：x/);
        assert.equal(error.taskId, "x");
        return true;
    });
});

test("Soon accepts string task ids, nested image results, and transient status-less polls", async () => {
    assert.deepEqual(parseSoonTask({ data: "task-string" }), {
        status: "pending", taskId: "task-string", progress: undefined,
    });
    assert.deepEqual(parseSoonTask({ data: { data: [{ image_url: "https://example.com/image.png" }] } }, "task-string"), {
        status: "completed", taskId: "task-string", urls: ["https://example.com/image.png"],
    });
    assert.deepEqual(parseSoonTask({ data: { status: "IN_PROGRESS" } }, "task-string"), {
        status: "pending", taskId: "task-string", progress: undefined,
    });
    const calls = [];
    const responses = [
        json({ data: "task-string" }),
        json({ data: { language: "zh" } }),
        json({ data: { status: "SUCCESS", data: { data: [{ url: "https://example.com/final.png" }] } } }),
    ];
    const output = await runSoonImageGeneration(config, "draw", [], {
        fetchImpl: async (url, init) => {
            calls.push({ url, method: init.method });
            return responses.shift();
        },
        sleep: async () => {},
    });
    assert.deepEqual(output, ["https://example.com/final.png"]);
    assert.equal(calls.filter(call => call.method === "POST").length, 1);
    assert.equal(calls.filter(call => call.method === "GET").length, 2);
    await assert.rejects(runSoonImageGeneration(config, "draw", [], {
        fetchImpl: async () => json({ code: 400, msg: "route denied" }),
    }), /route denied/);
});

test("Soon precompresses only uploads over 10 MB, leaving smaller originals untouched", async () => {
    const atLimit = new Blob([new Uint8Array(SOON_UPLOAD_MAX_BYTES)], { type: "image/png" });
    const oversized = new Blob([new Uint8Array(SOON_UPLOAD_MAX_BYTES + 1)], { type: "image/png" });
    const uploadCopy = new Blob(["compressed"], { type: "image/webp" });
    const sent = [];
    const compressionTargets = [];
    const options = {
        fetchImpl: async (endpoint, init) => {
            assert.equal(endpoint, SOON_UPLOAD_URL);
            sent.push(init.body.get("file"));
            return json({ url: "https://example.com/upload.png" });
        },
        compressImage: async (input, target) => {
            assert.strictEqual(input, oversized);
            compressionTargets.push(target);
            return uploadCopy;
        },
    };
    await uploadSoonReferenceBlob(config, atLimit, options);
    await uploadSoonReferenceBlob(config, oversized, options);
    assert.equal(SOON_UPLOAD_MAX_BYTES, 10 * 1024 * 1024);
    assert.deepEqual(compressionTargets, [9 * 1024 * 1024]);
    assert.equal(sent.length, 2);
    assert.equal(sent[0].size, atLimit.size);
    assert.equal(sent[0].type, "image/png");
    assert.equal(sent[1].size, uploadCopy.size);
    assert.equal(sent[1].type, "image/webp");
    assert.equal(oversized.size, SOON_UPLOAD_MAX_BYTES + 1);
});

test("Soon uploads the original first below 10 MB; 413 compresses only an upload copy", async () => {
    const original = new Blob(["original file content"], { type: "image/png" });
    const compressed = new Blob(["smaller"], { type: "image/webp" });
    const sent = [];
    let compressionCalls = 0;
    const url = await uploadSoonReferenceBlob(config, original, {
        fetchImpl: async (endpoint, init) => {
            assert.equal(endpoint, SOON_UPLOAD_URL);
            assert.equal(init.headers.Authorization, "Bearer sk-soon_test");
            sent.push(init.body.get("file"));
            return sent.length === 1 ? json({ error: { message: "too large" } }, 413)
                : json({ data: { url: "https://example.com/upload.png" } });
        },
        compressImage: async (input, target) => {
            assert.strictEqual(input, original);
            assert.ok(target > 0);
            compressionCalls++;
            return compressed;
        },
    });
    assert.equal(url, "https://example.com/upload.png");
    assert.equal(SOON_UPLOAD_URL, `${SOON_ORIGIN}/v1/files`);
    assert.equal(compressionCalls, 1);
    assert.strictEqual(await original.text(), "original file content");
    assert.equal(sent[0].type, "image/png");
    assert.equal(sent[1].type, "image/webp");
    assert.equal(sent[0].size, original.size);
});

test("Soon does not upload or change the original when precompression fails", async () => {
    const original = new Blob([new Uint8Array(SOON_UPLOAD_MAX_BYTES + 1)], { type: "image/png" });
    let uploads = 0;
    await assert.rejects(uploadSoonReferenceBlob(config, original, {
        compressImage: async () => new Blob([new Uint8Array(10 * 1024 * 1024)], { type: "image/webp" }),
        fetchImpl: async () => { uploads++; return json({ url: "https://example.com/upload.png" }); },
    }), /本地原图未修改/);
    assert.equal(uploads, 0);
    assert.equal(original.size, SOON_UPLOAD_MAX_BYTES + 1);
});

test("Soon upload never compresses on auth failure and rejects business-level errors", async () => {
    const original = new Blob(["image"], { type: "image/png" });
    let compressions = 0;
    await assert.rejects(uploadSoonReferenceBlob(config, original, {
        fetchImpl: async () => json({ error: { message: "unauthorized" } }, 401),
        compressImage: async () => { compressions++; return original; },
    }), /未授权/);
    assert.equal(compressions, 0);
    await assert.rejects(uploadSoonReferenceBlob(config, original, {
        fetchImpl: async () => json({ success: false, message: "upload rejected" }),
    }), /upload rejected/);
});

test("compiled canvas routes Soon without changing other providers or text defaults", () => {
    assert.match(bundle, /provider:"soon",models:SOON_SITE_MODELS/);
    assert.match(bundle, /e==="soon"\?\["nano-banana-pro"\]/);
    assert.match(bundle, /e==="soon"\?\[\]:APOLLO_TEXT_MODELS/);
    assert.match(bundle, /r\?\.provider==="soon"\?soonImagePrice\(e\)/);
    assert.match(bundle, /r\.provider==="soon"\)return\(await runSoonImageGeneration\(r,t,\[\]/);
    assert.match(bundle, /a\.provider==="soon"\).*soonReferenceSource/);
    assert.match(bundle, /soonBalancePending=balanceSite\.provider==="soon"/);
    assert.match(bundle, /Hu=soonBalancePending\?"\\u5f85\\u5f00\\u53d1"/);
    assert.match(bundle, /Ra=soonBalancePending\?"\\u5f85\\u5f00\\u53d1"/);
    assert.match(bundle, /Na=Ba&&\(soonBalancePending\|\|!!/);
    assert.match(bundle, /disabled:soonBalancePending,onRefresh:soonBalancePending\?void 0:zu/);
    assert.match(bundle, /disabled:soonBalancePending,onRefresh:soonBalancePending\?void 0:Ou/);
    assert.doesNotMatch(bundle, /balanceSite\.provider==="soon"\?window\.open/);
    assert.doesNotMatch(bundle, /\/api\/soon-account/);
});
