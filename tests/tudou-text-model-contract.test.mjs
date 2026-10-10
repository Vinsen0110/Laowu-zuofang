import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const bundle = await readFile(new URL("../assets/index-B2KJ37fm.js", import.meta.url), "utf8");
const priceTable = await readFile(new URL("../canvas-price-table.js", import.meta.url), "utf8");

test("Tudou does not expose Gemini 3.8 Flash as a text model", () => {
    assert.match(bundle, /TUDOU_TEXT_MODELS=\[\]/);
    assert.doesNotMatch(bundle, /tudou::gemini-3\.8-flash/);
    assert.match(
        bundle,
        /function siteTextModelNames\(e\)\{return e===RUNNINGHUB_SITE_ID\?RUNNINGHUB_TEXT_MODELS:e===TUDOU_SITE_ID\?TUDOU_TEXT_MODELS:e===GRSAI_SITE_ID\?GRSAI_TEXT_MODELS:e===APIMART_SITE_ID\?APIMART_TEXT_MODELS:e===SOON_SITE_ID\?\[\]:RUNNINGHUB_TEXT_MODELS\}/,
    );
    assert.match(bundle, /l7=\[\`\$\{DP\}::google\/gemini-3\.7-flash\`\]/);
    assert.match(bundle, /textModel:\`\$\{DP\}::google\/gemini-3\.7-flash\`/);
    assert.match(bundle, /o\.models\.includes\(pr\(v5\(t\)\)\)\|\|siteTextModelNames\(o\.id\)\.includes\(pr\(v5\(t\)\)\)/);
});

test("Tudou text requests keep the existing single-key Chat Completions route and reference handling", () => {
    assert.match(bundle, /messages:await prepareTextChatMessages\(chatCompletionMessages\(t\),e,r\?\.signal\)/);
    assert.match(bundle, /isTudouSite\(e\)\?xA\(e,"\/chat\/completions"\)/);
    assert.match(bundle, /headers:\{\.\.\.wA\(e,"application\/json"\),Accept:"application\/json"\}/);
});

test("Tudou's text model stays out of the image price table", () => {
    assert.doesNotMatch(priceTable, /gemini-3\.8-flash/);
    assert.match(priceTable, /if \(model === "nano-banana-2\.1"\)/);
    assert.match(priceTable, /if \(model === "nano-banana-pro"\)/);
});
