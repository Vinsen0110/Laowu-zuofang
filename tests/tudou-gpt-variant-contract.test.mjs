import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const bundle = await readFile(new URL("../assets/index-B2KJ37fm.js", import.meta.url), "utf8");

test("土豆 GPT 2.5 Flare / Sunburst is read back from the node everywhere Mart's variant is", () => {
    // Every node → panel config mapping that carries Mart's variant also carries 土豆's.
    const mart = bundle.match(/apimartGpt25Variant:t\??\.metadata\?\.apimartGpt25Variant[^,]*,/g) || [];
    const tudou = bundle.match(/tudouGpt25Variant:t\??\.metadata\?\.tudouGpt25Variant\|\|e\.tudouGpt25Variant\|\|an\.tudouGpt25Variant\|\|"flare",/g) || [];
    assert.ok(mart.length >= 3);
    assert.equal(tudou.length, mart.length);
    assert.match(bundle, /tudouGpt25Variant:a\.tudouGpt25Variant\|\|an\.tudouGpt25Variant\|\|"flare"/, "saved settings keep it");
    assert.match(bundle, /tudouGpt25Variant:inheritedImageModel\?sourceNode\.metadata\?\.tudouGpt25Variant/, "new nodes inherit it");
    // The request model follows the chosen variant.
    assert.match(bundle, /n==="gpt-image-2\.5"\?`gpt-image-2\.5-\$\{tudouGpt25Variant\(t\)\}-async`/);
});
