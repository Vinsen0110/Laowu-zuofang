import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const bundle = await readFile(new URL("../assets/index-B2KJ37fm.js", import.meta.url), "utf8");

test("text nodes show the generation timer once they have a start time", () => {
    assert.match(bundle, /,te=vI\(e\)\|\|e\.type===Ne\.Text&&!!e\.metadata\?\.generationStartedAt/);
});

test("first runs and retries record when text generation started and how long it took", () => {
    assert.match(bundle, /textStartedAt=new Date\(\)\.toISOString\(\);_\(sr=>sr\.map\(wn=>Vo\.includes\(wn\.id\)\?\{\.\.\.wn,metadata:\{\.\.\.wn\.metadata,generationStartedAt:textStartedAt/);
    assert.equal((bundle.match(/status:da,\.\.\.Y0\(textStartedAt\)/g) || []).length, 2);
    assert.match(bundle, /O\.type===Ne\.Image\|\|O\.type===Ne\.Text\?\{generationStartedAt:retryStartedAt/);
    assert.match(bundle, /content:zr\|\|yr,prompt:gt,status:da,\.\.\.Y0\(retryStartedAt\)/);
});

test("Tudou Gemini 3.8 Flash text asks for low reasoning (about 4s instead of minutes); other sites unchanged", () => {
    assert.match(bundle, /\.\.\.\(isTudouSite\(e\)&&\/\^gemini-3\\\.8-flash\$\/\.test\(e\.model\)\?\{reasoning_effort:"low"\}:\{\}\)/);
});
