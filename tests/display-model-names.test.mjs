import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../display-model-names.js", import.meta.url), "utf8");
const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const bundle = await readFile(new URL("../assets/index-B2KJ37fm.js", import.meta.url), "utf8");

test("maps the Grsai backend VIP model to the shared UI name", () => {
  assert.match(source, /\["gpt-image-2\.5",\s*"GPT image 2\.5"\]/);
  assert.match(source, /\["nano-banana-pro",\s*"Nano Banana Pro"\]/);
  assert.match(source, /\["gemini-3\.7-flash",\s*"Gemini 3\.7 Flash"\]/);
  assert.match(source, /\["gemini-3\.8-flash",\s*"Gemini 3\.8 Flash"\]/);
  assert.match(source, /canvas-model-picker/);
  assert.match(source, /settings-model-select/);
});

test("uses the repository Gemini SVG for the unified Flash model", () => {
  assert.match(source, /\["gemini-3\.7-flash",\s*"\.\/icons\/gemini\.svg"\]/);
  assert.match(source, /\["gemini-3\.8-flash",\s*"\.\/icons\/gemini\.svg"\]/);
  assert.match(source, /setAttribute\("src", icon\)/);
  assert.match(source, /\.canvas-composer-model-picker/);
  assert.match(source, /replaceWith\(replacement\)/);
});

test("loads the display-only model label layer after the app bundle", () => {
  const bundleIndex = html.indexOf("index-B2KJ37fm.js");
  const labelLayerIndex = html.indexOf("display-model-names.js");
  assert.ok(bundleIndex >= 0);
  assert.ok(labelLayerIndex > bundleIndex);
});


test("image model labels use the requested casing and spacing", () => {
    assert.match(bundle, /t===\"nano-banana-2\.1\"\?\"Nano Banana 2\.1\":t\.startsWith\(\"nano-banana-pro\"\)\?\"Nano Banana Pro\":t\.startsWith\(\"gpt-image-2\.5\"\)\?\"GPT image 2\.5\"/);
});
