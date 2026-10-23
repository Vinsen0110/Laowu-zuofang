import assert from "node:assert/strict";
import test from "node:test";

import { lwSellPrice } from "../account-pricing.js";
import { priceCatalog } from "../account/catalog.js";

// Give every catalog row a distinct price, then check the canvas computes the
// row the relay would charge for typical canvas configs.
const rows = priceCatalog();
const prices = rows.map((r, i) => ({ channel: r.channel, model: r.model, spec: r.spec, price: (i + 1) / 100 }));
const priceOf = (channel, model, spec) => prices.find((p) => p.channel === channel && p.model === model && p.spec === spec)?.price;

test("GPT Image 2 is gone from the price catalog", () => {
    assert.equal(rows.filter((r) => /^gpt-image-2-(all|vip)$/.test(r.model)).length, 0);
});

test("canvas selling price matches the relay's catalog row on every site", () => {
    const cases = [
        [{ model: "tudou::nano-banana-pro", quality: "4k" }, "tudou", ["tudou", "gemini-3-pro-image-preview", "4k"]],
        [{ model: "tudou::gpt-image-2.5", quality: "2k", gptImageQuality: "xhigh", tudouGpt25Variant: "sunburst" }, "tudou", ["tudou", "gpt-image-2.5-sunburst-async", "2k/xhigh"]],
        [{ model: "apimart::nano-banana-pro", quality: "2k", size: "1:1" }, "apimart", ["apimart", "gemini-3-pro-image-preview", "2k"]],
        [{ model: "apimart::gpt-image-2.5", quality: "4k", size: "1:1", gptImageQuality: "fixed" }, "apimart", ["apimart", "gpt-image-2.5-ext", "4k"]],
        [{ model: "rh::nano-banana-pro", quality: "1k", size: "1:1" }, "runninghub", ["runninghub", "rhart-image-n-pro", "1k"]],
        [{ model: "grsai::nano-banana-2.1", quality: "2k", size: "1:1" }, "grsai", ["grsai", "nano-banana-2.1", "2k"]],
        [{ model: "soon::nano-banana-pro", quality: "4k", size: "1:1" }, "soon", ["soon", "gemini-3-pro-image", "4k"]],
    ];
    for (const [config, provider, key] of cases) {
        const expected = priceOf(...key);
        assert.ok(expected, `catalog has ${key.join(" / ")}`);
        assert.equal(lwSellPrice(config, { provider }, prices), expected, key.join(" / "));
    }
});

test("unpriced or unknown models show no price", () => {
    assert.equal(lwSellPrice({ model: "tudou::nano-banana-pro", quality: "1k" }, { provider: "tudou" }, []), null);
    assert.equal(lwSellPrice({ model: "x::y" }, { provider: "nope" }, prices), null);
    assert.equal(lwSellPrice({ model: "tudou::nano-banana-pro" }, { provider: "tudou" }, null), null);
});
