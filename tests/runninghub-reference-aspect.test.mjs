import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import {
    isRunningHubSite,
    runningHubImageModel,
    runningHubImageRequestSpec,
    runningHubReferenceAspectRatio,
    runningHubSupportedAspectRatios,
} from "../runninghub-api.js";

const source = await readFile(new URL("../assets/index-B2KJ37fm.js", import.meta.url), "utf8");
const plain = value => JSON.parse(JSON.stringify(value));
const base = {
    provider: "runninghub",
    model: "runninghub::nano-banana-pro",
    quality: "4k",
    size: "auto",
};

function functionSource(name) {
    let start = source.indexOf(`function ${name}(`);
    assert.notEqual(start, -1, `Missing shipped function ${name}`);
    if (source.slice(start - 6, start) === "async ") start -= 6;
    for (let end = source.indexOf("}", start); end !== -1; end = source.indexOf("}", end + 1)) {
        const candidate = source.slice(start, end + 1);
        try {
            new vm.Script(`(${candidate})`);
            return candidate;
        } catch (error) {
            if (!(error instanceof SyntaxError)) throw error;
        }
    }
    throw new Error(`Cannot extract ${name}`);
}

function runtime({ width = 3840, height = 2160, decodeError, sourceError, pendingDecode = false } = {}) {
    const calls = { decoded: [], resolved: [], uploaded: [], submitted: [] };
    const context = vm.createContext({
        isRunningHubSite,
        runningHubImageModel,
        runningHubReferenceAspectRatio,
        runningHubSupportedAspectRatios,
        isGrsaiSite: () => false,
        isApiMartSite: () => false,
        isTudouSite: () => false,
        RX: value => value,
        ll: value => value,
        $Me: prompt => prompt,
        pr: value => String(value).split("::").at(-1),
        Xl: async (key, fallback) => {
            calls.resolved.push({ key, fallback });
            if (sourceError) throw sourceError;
            return fallback || `blob:${key}`;
        },
        Image: class {
            naturalWidth = width;
            naturalHeight = height;
            set src(url) {
                calls.decoded.push(url);
                if (pendingDecode) return;
                queueMicrotask(() => {
                    if (decodeError) this.onerror?.(decodeError);
                    else this.onload?.();
                });
            }
            removeAttribute() {}
        },
        setTimeout,
        clearTimeout,
        DOMException,
        runningHubReferenceSource: async (_config, reference) => {
            calls.uploaded.push(reference);
            return `https://rh.test/reference-${calls.uploaded.length}.png`;
        },
        runRunningHubImageGeneration: async (config, prompt, references) => {
            calls.submitted.push({
                config: plain(config),
                spec: runningHubImageRequestSpec(config, prompt, references),
            });
            return ["https://rh.test/result.png"];
        },
        cn: () => "output-id",
        th: error => error.message,
    });
    for (const name of ["runningHubRatioValue", "withRunningHubReferenceAspectRatio", "P0"]) {
        vm.runInContext(functionSource(name), context);
    }
    return { context, calls };
}

test("RH uses the same reference ratio at 2K and 4K without mutating stored Auto", () => {
    for (const quality of ["2k", "4k"]) {
        const config = { ...base, quality };
        const resolved = runningHubReferenceAspectRatio(config, 3840, 2160);
        assert.equal(resolved.size, "16:9");
        assert.equal(resolved.quality, quality);
        assert.equal(config.size, "auto");
        assert.notEqual(resolved, config);
        const spec = runningHubImageRequestSpec(resolved, "edit", ["https://rh.test/ref.png"]);
        assert.equal(spec.body.aspectRatio, "16:9");
        assert.equal(spec.body.resolution, quality);
    }
});

test("RH reference ratio picks the closest supported horizontal, vertical and extreme ratio", () => {
    for (const [width, height, expected] of [
        [3840, 2160, "16:9"],
        [2160, 3840, "9:16"],
        [1500, 1000, "3:2"],
        [1000, 1500, "2:3"],
        [1536, 1536, "1:1"],
        [2100, 900, "21:9"],
        [900, 2100, "9:16"],
        [5000, 1000, "21:9"],
        [1000, 5000, "9:16"],
        [2000, 1000, "16:9"],
    ]) {
        assert.equal(runningHubReferenceAspectRatio(base, width, height).size, expected, `${width}x${height}`);
    }
});

test("Nano Banana Pro exposes ten supported ratios while the retired GPT Image 2 keeps fifteen", () => {
    const nano = runningHubSupportedAspectRatios(base);
    assert.equal(nano.length, 10);
    for (const ratio of ["2:1", "1:2", "3:1", "1:3", "9:21"]) assert.equal(nano.includes(ratio), false, ratio);
    assert.equal(runningHubSupportedAspectRatios({ ...base, model: "gpt-image-2" }).length, 15);
});

test("old fixed projects with unsupported explicit ratios omit aspectRatio rather than send a rejected value", () => {
    for (const size of ["2:1", "1:2", "3:1", "1:3", "9:21"]) {
        const spec = runningHubImageRequestSpec({ ...base, size }, "draw");
        assert.equal(Object.hasOwn(spec.body, "aspectRatio"), false, size);
    }
});

test("explicit ratios and the retired GPT Image 2 bypass reference inference", () => {
    for (const config of [
        { ...base, size: "4:5" },
        { ...base, model: "runninghub::gpt-image-2" },
    ]) {
        assert.equal(runningHubReferenceAspectRatio(config, 3840, 2160), config);
    }
});

test("RH Nano Banana Pro follows the reference image's shape on Auto", () => {
    const model = "runninghub::nano-banana-pro";
    assert.equal(runningHubReferenceAspectRatio({ ...base, model }, 1080, 1920).size, "9:16");
    assert.equal(runningHubReferenceAspectRatio({ ...base, model }, 3840, 2160).size, "16:9");
});

test("ratio inference keeps the other settings and routes to the Nano Banana Pro edit endpoint", () => {
    const config = { ...base, quality: "2k" };
    const resolved = runningHubReferenceAspectRatio(config, 2160, 3840);
    assert.deepEqual(resolved, { ...config, size: "9:16" });
    const spec = runningHubImageRequestSpec(resolved, "edit", ["https://rh.test/ref.png"]);
    assert.equal(spec.body.aspectRatio, "9:16");
    assert.equal(spec.endpoint, "/openapi/v2/rhart-image-n-pro/edit");
});

test("invalid decoded dimensions fail instead of submitting an unconstrained Auto request", () => {
    for (const [width, height] of [[0, 100], [100, 0], [-1, 100], [100, -1],
        [NaN, 100], [100, NaN], [Infinity, 100], [100, Infinity]]) {
        assert.throws(() => runningHubReferenceAspectRatio(base, width, height));
    }
});

test("actual RH edit flow uses the first image's decoded pixels, never its canvas frame size", async () => {
    const { context, calls } = runtime({ width: 3840, height: 2160 });
    const first = { storageKey: "first-image", width: 100, height: 400 };
    const second = { dataUrl: "blob:second-image", width: 1000, height: 1000 };
    const result = await context.P0(base, "edit", [first, second], null, {});
    assert.deepEqual(calls.decoded, ["blob:first-image"]);
    assert.deepEqual(calls.resolved, [{ key: "first-image", fallback: "" }]);
    assert.deepEqual(calls.uploaded, [first, second]);
    assert.equal(calls.submitted.length, 1);
    assert.equal(calls.submitted[0].spec.body.aspectRatio, "16:9");
    assert.equal(calls.submitted[0].spec.body.imageUrls.length, 2);
    assert.equal(base.size, "auto");
    assert.equal(result[0].dataUrl, "https://rh.test/result.png");
});

test("actual RH edit flow never submits or uploads after source/dimension decoding fails", async () => {
    for (const options of [
        { decodeError: new Error("Cannot decode reference") },
        { sourceError: new Error("Missing stored reference") },
        { width: 0 },
    ]) {
        const { context, calls } = runtime(options);
        await assert.rejects(context.P0(base, "edit", [{ storageKey: "broken" }], null, {}));
        assert.equal(calls.submitted.length, 0);
        assert.equal(calls.uploaded.length, 0);
    }
});

test("legacy 2:1 edits recover as Auto and infer a supported first-image ratio", async () => {
    const { context, calls } = runtime({ width: 2000, height: 1000 });
    const config = { ...base, size: "2:1" };
    await context.P0(config, "edit", [{ dataUrl: "blob:reference" }], null, {});
    assert.equal(config.size, "2:1");
    assert.equal(calls.submitted[0].spec.body.aspectRatio, "16:9");
    assert.equal(calls.decoded.length, 1);
});

test("manual ratio edits bypass decoding and retain the selected ratio", async () => {
    const { context, calls } = runtime({ decodeError: new Error("must not decode") });
    await context.P0({ ...base, size: "4:5" }, "edit", [{ dataUrl: "blob:reference" }], null, {});
    assert.equal(calls.decoded.length, 0);
    assert.equal(calls.submitted[0].spec.body.aspectRatio, "4:5");
});

test("no-reference generation leaves Auto unchanged and does not read image pixels", async () => {
    const { context, calls } = runtime({ decodeError: new Error("must not decode") });
    const resolved = await context.withRunningHubReferenceAspectRatio(base, []);
    assert.equal(resolved, base);
    assert.equal(calls.decoded.length, 0);
    const spec = runningHubImageRequestSpec(resolved, "draw");
    assert.equal(spec.endpoint, "/openapi/v2/rhart-image-n-pro/text-to-image");
    assert.equal(Object.hasOwn(spec.body, "aspectRatio"), false);
});

test("the browser helper does not infer ratios for Mart, other sites or older RH models", async () => {
    const { context, calls } = runtime({ decodeError: new Error("must not decode") });
    for (const config of [
        { ...base, provider: "apimart", model: "apimart::nano-banana-pro" },
        { ...base, provider: "custom", model: "custom::nano-banana-pro" },
        { ...base, model: "runninghub::gpt-image-2" },
    ]) {
        assert.equal(await context.withRunningHubReferenceAspectRatio(config, ["blob:ref"]), config);
    }
    assert.equal(calls.decoded.length, 0);
});

test("cancelling reference decoding prevents an upload or billable submission", async () => {
    for (const abortFirst of [true, false]) {
        const { context, calls } = runtime({ pendingDecode: true });
        const controller = new AbortController();
        if (abortFirst) controller.abort();
        const pending = context.P0(base, "edit", [{ dataUrl: "blob:ref" }], null, {
            signal: controller.signal,
        });
        if (!abortFirst) controller.abort();
        await assert.rejects(pending, /abort/i);
        assert.equal(calls.uploaded.length, 0);
        assert.equal(calls.submitted.length, 0);
    }
});
