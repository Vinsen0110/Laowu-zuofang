import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

import { lwSellPrice } from "../account-pricing.js";
import { priceCatalog } from "../account/catalog.js";
import { CHANNELS } from "../account/channels.js";

const bundle = await readFile(new URL("../assets/index-B2KJ37fm.js", import.meta.url), "utf8");
const priceTable = await readFile(new URL("../canvas-price-table.js", import.meta.url), "utf8");

function functionSource(name) {
    const start = bundle.indexOf(`function ${name}(`);
    assert.notEqual(start, -1, `${name} must exist in the shipped bundle`);
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

const context = vm.createContext({ VR: "::", DP: "runninghub", __lwIsAdmin: true });
for (const name of [
    "$S", "pr", "ES", "v5", "jMe", "isTudouNano21Model", "tudouResolution", "tudouQuality",
    "tudouGpt25Variant", "tudouBackendModel", "tudouImagePrice",
]) {
    vm.runInContext(functionSource(name), context);
}

test("土豆 offers GPT image 2.6 instead of 2.5", () => {
    assert.match(bundle, /TUDOU_SITE_MODELS=\["nano-banana-2\.1","nano-banana-pro","gpt-image-2\.6"\]/);
    assert.match(bundle, /TUDOU_IMAGE_MODELS=\["nano-banana-2\.1","nano-banana-pro","gpt-image-2\.6"\]/);
    assert.match(bundle, /`\$\{TUDOU_SITE_ID\}::gpt-image-2\.6`/);
    assert.deepEqual(CHANNELS.find((c) => c.id === "tudou").models, ["nano-banana-2.1", "nano-banana-pro", "gpt-image-2.6", "gemini-3.8-flash"]);
});

test("the canvas shows GPT image 2.6; other sites keep GPT image 2.5", () => {
    assert.match(bundle, /t\.startsWith\("gpt-image-2\.6"\)\?"GPT image 2\.6":t\.startsWith\("gpt-image-2\.5"\)\?"GPT image 2\.5"/);
    // The node toolbar's model button too, not only the menu.
    assert.match(bundle, /pr\(t\)==="gpt-image-2\.6"\?"GPT image 2\.6":uy\(e,t\)/);
    assert.match(priceTable, /GPT Image 2\.6 · Flare/);
    assert.match(priceTable, /GPT Image 2\.6 · Sunburst/);
});

test("Flare / Sunburst map to the 2.6 async backend models", () => {
    for (const [variant, backend] of [["flare", "gpt-image-2.6-flare-async"], ["sunburst", "gpt-image-2.6-sunburst-async"], [undefined, "gpt-image-2.6-flare-async"]]) {
        assert.equal(context.tudouBackendModel("tudou::gpt-image-2.6", { tudouGpt25Variant: variant }), backend);
    }
    assert.match(bundle, /isTudouGpt25=pr\(t\.model\)==="gpt-image-2\.6"&&isTudouSite\(u\)/);
    assert.match(bundle, /value:w,items:TUDOU_GPT25_QUALITY_OPTIONS/);
});

test("2.6 only sends 1K/2K and low/medium/high", () => {
    const config = (quality, gptImageQuality) => ({ model: "tudou::gpt-image-2.6", quality, gptImageQuality });
    for (const [quality, expected] of [["1k", "1k"], ["2k", "2k"], ["4k", "2k"], ["high", "2k"], ["auto", "1k"]]) {
        assert.equal(context.tudouResolution(config(quality)), expected, quality);
    }
    for (const [q, expected] of [["low", "low"], ["medium", "medium"], ["high", "high"], ["xhigh", "high"], ["max", "high"], ["", "medium"]]) {
        assert.equal(context.tudouQuality(config("2k", q)), expected, q);
    }
    assert.match(bundle, /TUDOU_GPT25_QUALITY_OPTIONS=\[\{value:"low",label:"Low"\},\{value:"medium",label:"Medium"\},\{value:"high",label:"High"\}\];/);
    // 4K is greyed out in the node toolbar and in the image settings panel.
    assert.match(bundle, /items:isTudouGpt25\?hX\.map\(C=>C\.value==="4k"\?\{\.\.\.C,disabled:!0/);
    assert.match(bundle, /disabled:isTudouGpt26&&k\.value==="4k"/);
    // Nano Banana on 土豆 still has 4K.
    assert.equal(context.tudouResolution({ model: "tudou::nano-banana-pro", quality: "4k" }), "4k");
});

test("2.6 costs ¥0.07 per image for both variants", () => {
    for (const variant of ["flare", "sunburst"]) {
        for (const quality of ["1k", "2k"]) {
            for (const q of ["low", "medium", "high"]) {
                assert.equal(context.tudouImagePrice({ model: "tudou::gpt-image-2.6", quality, gptImageQuality: q, tudouGpt25Variant: variant }), 0.07);
            }
        }
    }
});

test("saved 土豆 and Mart GPT 2.5 selections move to 2.6; RunningHub's 2.5 is untouched", () => {
    assert.equal(context.v5("tudou::gpt-image-2.5"), "tudou::gpt-image-2.6");
    assert.equal(context.v5("apimart::gpt-image-2.5"), "apimart::gpt-image-2.6");
    assert.equal(context.v5("apimart::gpt-image-2.6"), "apimart::gpt-image-2.6");
    assert.equal(context.v5("rh::gpt-image-2.5"), "rh::gpt-image-2.5");
    assert.equal(context.v5("tudou::gpt-image-2.6"), "tudou::gpt-image-2.6");
});

test("the relay catalog prices 2.6 by variant, 1K/2K and quality, and has no 土豆 2.5", () => {
    const rows = priceCatalog().filter((r) => r.channel === "tudou" && r.model.startsWith("gpt-image-2."));
    assert.equal(rows.filter((r) => r.model.startsWith("gpt-image-2.5")).length, 0);
    for (const model of ["gpt-image-2.6-flare-async", "gpt-image-2.6-sunburst-async"]) {
        assert.deepEqual(rows.filter((r) => r.model === model).map((r) => r.spec).sort(),
            ["1k/high", "1k/low", "1k/medium", "2k/high", "2k/low", "2k/medium"]);
    }
    assert.ok(rows.every((r) => r.cost === 0.07));
    // The canvas selling price looks up the same row (4K falls back to 2K).
    const prices = rows.map((r, i) => ({ channel: r.channel, model: r.model, spec: r.spec, price: (i + 1) / 100 }));
    const priceOf = (model, spec) => prices.find((p) => p.model === model && p.spec === spec).price;
    const sell = (patch) => lwSellPrice({ model: "tudou::gpt-image-2.6", ...patch }, { provider: "tudou" }, prices);
    assert.equal(sell({ quality: "2k", gptImageQuality: "high", tudouGpt25Variant: "sunburst" }), priceOf("gpt-image-2.6-sunburst-async", "2k/high"));
    assert.equal(sell({ quality: "4k", gptImageQuality: "max" }), priceOf("gpt-image-2.6-flare-async", "2k/high"));
});
