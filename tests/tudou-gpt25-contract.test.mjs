import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const bundle = await readFile(new URL("../assets/index-B2KJ37fm.js", import.meta.url), "utf8");
const priceTable = await readFile(new URL("../canvas-price-table.js", import.meta.url), "utf8");

test("Tudou exposes GPT Image 2.5 while keeping existing image models", () => {
    assert.match(bundle, /TUDOU_SITE_MODELS=\["nano-banana-2\.1","nano-banana-pro","gpt-image-2\.5"\]/);
    assert.match(bundle, /TUDOU_IMAGE_MODELS=\["nano-banana-2\.1","nano-banana-pro","gpt-image-2\.5"\]/);
});

test("Tudou GPT Image 2.5 maps Flare and Sunburst to async backend models", () => {
    assert.match(bundle, /n==="gpt-image-2\.5"\?`gpt-image-2\.5-\$\{tudouGpt25Variant\(t\)\}-async`/);
    assert.match(bundle, /function tudouGpt25Variant\(e\)/);
    assert.match(bundle, /isTudouGpt25=pr\(t\.model\)==="gpt-image-2\.5"&&isTudouSite\(u\)/);
    assert.match(bundle, /tudouGpt25Variant\(t\),items:APIMART_GPT25_VARIANT_OPTIONS/);
    assert.match(bundle, /TUDOU_GPT25_QUALITY_OPTIONS=\[\{value:"low",label:"Low"\},\{value:"medium",label:"Medium"\},\{value:"high",label:"High"\},\{value:"xhigh",label:"XHigh"\},\{value:"max",label:"Max"\}\]/);
    assert.match(bundle, /value:w,items:TUDOU_GPT25_QUALITY_OPTIONS/);
});

test("Tudou GPT Image 2.5 keeps the shared ratios and has separate variant prices", () => {
    assert.match(bundle, /t===\"gpt-image-2\.5\"/);
    assert.match(bundle, /tudouGpt25Variant\(e\)==="sunburst"/);
    assert.match(priceTable, /GPT Image 2\.5 · Flare/);
    assert.match(priceTable, /GPT Image 2\.5 · Sunburst/);
});
