import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

import { lwSellPrice } from "../account-pricing.js";
import { priceCatalog, withPriceAliases } from "../account/catalog.js";
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

test("the canvas shows GPT image 2.6 and no longer labels GPT image 2.5", () => {
    assert.match(bundle, /t\.startsWith\("gpt-image-2\.6"\)\?"GPT image 2\.6":t==="gpt-image-2-vip"/);
    assert.doesNotMatch(bundle, /"GPT image 2\.5"/);
    // The node toolbar's model button too, not only the menu.
    assert.match(bundle, /pr\(t\)==="gpt-image-2\.6"\?"GPT image 2\.6":uy\(e,t\)/);
    assert.match(priceTable, /GPT Image 2\.6 · Flare/);
    assert.match(priceTable, /GPT Image 2\.6 · Sunburst/);
});

test("Flare / Sunburst map to 土豆's synchronous 2.6 models", () => {
    for (const [variant, backend] of [["flare", "gpt-image-2.6-flare"], ["sunburst", "gpt-image-2.6-sunburst"], [undefined, "gpt-image-2.6-flare"]]) {
        assert.equal(context.tudouBackendModel("tudou::gpt-image-2.6", { tudouGpt25Variant: variant }), backend);
    }
    assert.match(bundle, /isTudouGpt25=pr\(t\.model\)==="gpt-image-2\.6"&&isTudouSite\(u\)/);
    assert.match(bundle, /value:w,items:TUDOU_GPT25_QUALITY_OPTIONS/);
});

test("2.6 sends 1K/2K/4K and low/medium/high", () => {
    const config = (quality, gptImageQuality) => ({ model: "tudou::gpt-image-2.6", quality, gptImageQuality });
    for (const [quality, expected] of [["1k", "1k"], ["2k", "2k"], ["4k", "4k"], ["high", "4k"], ["auto", "1k"]]) {
        assert.equal(context.tudouResolution(config(quality)), expected, quality);
    }
    for (const [q, expected] of [["low", "low"], ["medium", "medium"], ["high", "high"], ["xhigh", "high"], ["max", "high"], ["", "medium"]]) {
        assert.equal(context.tudouQuality(config("2k", q)), expected, q);
    }
    assert.match(bundle, /TUDOU_GPT25_QUALITY_OPTIONS=\[\{value:"low",label:"Low"\},\{value:"medium",label:"Medium"\},\{value:"high",label:"High"\}\][;,]/);
    // 4K is selectable in the node toolbar and in the image settings panel.
    assert.doesNotMatch(bundle, /GPT image 2\.6 暂不支持 4K|GPT image 2\.6 \\u6682\\u4E0D\\u652F\\u6301 4K/);
    assert.match(bundle, /y\.jsx\(n\$,\{value:m,items:hX,/);
    // Nano Banana on 土豆 still has 4K.
    assert.equal(context.tudouResolution({ model: "tudou::nano-banana-pro", quality: "4k" }), "4k");
});

test("2.6 costs ¥0.025 per image for both variants", () => {
    for (const variant of ["flare", "sunburst"]) {
        for (const quality of ["1k", "2k"]) {
            for (const q of ["low", "medium", "high"]) {
                assert.equal(context.tudouImagePrice({ model: "tudou::gpt-image-2.6", quality, gptImageQuality: q, tudouGpt25Variant: variant }), 0.025);
            }
        }
    }
});

test("saved model names pass through unchanged, and the bundle no longer knows GPT image 2.5", () => {
    assert.equal(context.v5("apimart::gpt-image-2.6"), "apimart::gpt-image-2.6");
    assert.equal(context.v5("tudou::gpt-image-2.6"), "tudou::gpt-image-2.6");
    assert.equal(bundle.includes("gpt-image-2.5"), false);
});

test("土豆 2.6 has one catalog price for both variants, every resolution and quality, and no 土豆 2.5", () => {
    const rows = priceCatalog().filter((r) => r.channel === "tudou" && r.model.startsWith("gpt-image-2."));
    assert.deepEqual(rows.map(({ label, model, spec, cost, also }) => ({ label, model, spec, cost, also })), [
        { label: "GPT Image 2.6 · 固定", model: "gpt-image-2.6-flare", spec: "", cost: 0.025, also: ["gpt-image-2.6-sunburst"] },
    ]);
    // Saving it writes the same price for Sunburst; the canvas finds it for any variant / spec (4K falls back to 2K).
    const prices = withPriceAliases([{ channel: "tudou", model: rows[0].model, spec: "", price: 0.2 }]);
    assert.deepEqual(prices.map((p) => p.model), ["gpt-image-2.6-flare", "gpt-image-2.6-sunburst"]);
    const sell = (patch) => lwSellPrice({ model: "tudou::gpt-image-2.6", ...patch }, { provider: "tudou" }, prices);
    assert.equal(sell({ quality: "2k", gptImageQuality: "high", tudouGpt25Variant: "sunburst" }), 0.2);
    assert.equal(sell({ quality: "1k", gptImageQuality: "low", tudouGpt25Variant: "flare" }), 0.2);
    assert.equal(sell({ quality: "4k", gptImageQuality: "max" }), 0.2);
});
