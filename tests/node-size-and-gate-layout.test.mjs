import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const bundle = await readFile(new URL("../assets/index-B2KJ37fm.js", import.meta.url), "utf8");
const ui = await readFile(new URL("../account-ui.js", import.meta.url), "utf8");

test("image nodes share one height and take their width from the image ratio", () => {
    const fit = new Function(`${bundle.match(/function lwFitImage\([^]*?\}(?=function lwSizeShape)/)[0]}; return lwFitImage;`)();
    assert.deepEqual(fit(1080, 1920), { width: 225, height: 400 });
    assert.deepEqual(fit(1000, 1000), { width: 400, height: 400 });
    assert.deepEqual(fit(4000, 1000), { width: 960, height: 240 });
    assert.match(bundle, /function Li\(e,t,n,r\)\{if\(n===void 0&&r===void 0\)return lwFitImage\(e,t\);/);
    assert.match(bundle, /function K0\(e,t,n\)\{return lwFitImage\(e,t,n\?\.metadata\?\.content\?Math\.max\(400,n\.height\|\|0\):400\)\}/);
});

test("an empty image node takes the chosen ratio's shape right away", () => {
    assert.match(bundle, /e\.type===Ne\.Video\?PW\(n\.size,o\.width,o\.height\):lwSizeShape\(n\.size\):null;return a\?/);
});

test("the entry page centres the headline with the brand on top", () => {
    assert.match(ui, /\.lw-gate-caption\{position:absolute;left:10%;right:10%;top:50%;translate:0 -50%;color:#fff;text-align:center\}/);
    assert.match(ui, /<div class="lw-gate-shade"><\/div>\s*<div class="lw-gate-brand">/);
});

test("connection handles stay 16-22px on screen, sit close to the node and follow the theme", () => {
    assert.match(bundle, /lwPx=Math\.min\(22,Math\.max\(16,22\*i\)\),l=lwPx\/i,d=\(lwPx\+12\)\/i,f=-\(lwPx\+12\)\/i;/);
    assert.match(bundle, /background:o\?"var\(--laowu-handle-bg-hover\)":"var\(--laowu-handle-bg\)"/);
});

test("the entry headline is a single line", () => {
    assert.match(ui, /<h1>无限画布 无限创作<\/h1>/);
    assert.doesNotMatch(ui, /把想法变成图片/);
});
