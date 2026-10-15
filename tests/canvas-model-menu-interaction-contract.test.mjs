import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const bundle = await readFile(new URL("../assets/index-B2KJ37fm.js", import.meta.url), "utf8");
const indexHtml = await readFile(new URL("../index.html", import.meta.url), "utf8");

function modelMenuBlock() {
    const start = bundle.indexOf("function uke(");
    const end = bundle.indexOf("function n$(", start);
    assert.ok(start >= 0 && end > start, "missing canvas model menu block");
    return bundle.slice(start, end);
}

test("model providers preview on mouse hover while model selection stays click-only", () => {
    assert.match(indexHtml, /document\.addEventListener\("pointerover"/);
    assert.match(indexHtml, /event\.pointerType !== "mouse"/);
    assert.match(indexHtml, /\.canvas-model-menu > div > div > div:first-child > button/);
    assert.match(indexHtml, /button\.click\(\)/);

    const menu = modelMenuBlock();
    assert.match(menu, /onClick:S=>\{S\.preventDefault\(\),g\(x\.name\)\}/);
    assert.match(menu, /v\.models\.map\(x=>y\.jsx\(Ud,\{value:x/);
});

test("model provider column has a neutral background and subtle motion", () => {
    assert.match(
        indexHtml,
        /\.canvas-model-menu > div > div > div:first-child \{[^}]*background: var\(--lw-stone-100\) !important;/s,
    );
    assert.match(
        indexHtml,
        /\.canvas-model-menu > div > div > div:first-child > button \{[^}]*color: var\(--lw-stone-600\) !important;[^}]*transform 150ms ease/s,
    );
    assert.match(
        indexHtml,
        /button\.bg-white,\s*[^{]*\{[^}]*background: var\(--lw-white\) !important;[^}]*color: var\(--lw-stone-900\) !important;[^}]*translateX\(2px\)/s,
    );
    assert.match(
        indexHtml,
        /\.dark \.canvas-model-menu button\.bg-white,\s*[^{]*\{[^}]*background: var\(--lw-stone-800\) !important;[^}]*color: var\(--lw-stone-100\) !important;/s,
    );
});

test("only model menu typography is one step more compact", () => {
    assert.match(
        indexHtml,
        /\.canvas-model-menu > div > div > div:first-child > button,[^}]*\.canvas-model-menu \[role="option"\] span \{[^}]*font-size: 11px !important;/s,
    );
    assert.doesNotMatch(indexHtml, /\.canvas-model-select,[^}]*font-size: 11px !important;/s);
});
