import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const bundle = await readFile(new URL("../assets/index-B2KJ37fm.js", import.meta.url), "utf8");

test("connected image generation panels inherit valid upstream model settings", () => {
    assert.match(bundle, /sourceImageModel=O===Ne\.Image&&sourceNode\?\.metadata\?\.model\?yx\(sourceNode\.metadata\.model,N\.channels\):""/);
    assert.match(bundle, /inheritedImageModel=sourceImageModel&&\(CS\(N,"image"\)\|\|\[\]\)\.includes\(sourceImageModel\)\?sourceImageModel:""/);
    assert.match(bundle, /model:inheritedImageModel\|\|N\.imageModel\|\|N\.model/);
    assert.match(bundle, /quality:inheritedImageModel\?sourceNode\.metadata\?\.quality\|\|N\.quality:N\.quality/);
    assert.match(bundle, /gptImageQuality:inheritedImageModel\?sourceNode\.metadata\?\.gptImageQuality\|\|N\.gptImageQuality:N\.gptImageQuality/);
    assert.match(bundle, /apimartOutputFormat:inheritedImageModel\?sourceNode\.metadata\?\.apimartOutputFormat\|\|N\.apimartOutputFormat:N\.apimartOutputFormat/);
    assert.match(bundle, /apimartBackground:inheritedImageModel\?sourceNode\.metadata\?\.apimartBackground\|\|N\.apimartBackground:N\.apimartBackground/);
    assert.match(bundle, /size:inheritedImageModel\?sourceNode\.metadata\?\.size\|\|"auto":"auto"/);
    assert.match(bundle, /count:pm\(inheritedImageModel\?sourceNode\.metadata\?\.count\|\|N\.canvasImageCount\|\|N\.count:N\.canvasImageCount\|\|N\.count\)/);
});

test("standalone node creation remains on the global image defaults", () => {
    assert.match(bundle, /Jo=c\.useCallback\([\s\S]*?model:N\.imageModel\|\|N\.model/);
});
