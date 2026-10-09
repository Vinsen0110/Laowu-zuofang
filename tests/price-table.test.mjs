import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const html = await readFile(new URL("index.html", root), "utf8");
const script = await readFile(new URL("canvas-price-table.js", root), "utf8");

test("canvas price table is loaded as a local module and keeps provider currency rules", () => {
  assert.match(html, /canvas-price-table\.js/);
  assert.match(script, /const DEFAULT_FX_RATE = 6\.7/);
  assert.match(script, /FX_STORAGE_KEY/);
  assert.match(script, /runninghub: "RH", apimart: "Mart", soon: "Soon", tudou: "Tudou", grsai: "Grsai"/);
  assert.match(script, /\["runninghub", "apimart"\]\.includes\(provider\) \? "USD" : "CNY"/);
  assert.doesNotMatch(script, /DEFAULT_ROWS/);
  assert.match(script, /模型价格（人民币）/);
  assert.match(script, /人民币 = 美元 × 汇率/);
  assert.match(script, /表内只显示人民币/);
  assert.match(script, /type = "number"/);
});

test("price table is mounted as an icon in the lower-left canvas toolbar", () => {
  assert.match(script, /canvas-price-table-shell/);
  assert.match(script, /canvas-price-table-divider/);
  assert.match(script, /data-price-table-divider/);
  assert.match(script, /getDivider\("after"\)/);
  assert.match(script, /canvas-price-table-toggle/);
  assert.match(script, /aria-label", "打开模型价格表/);
  assert.match(script, /<svg viewBox="0 0 24 24"/);
  assert.match(script, /<rect x="3" y="5" width="18" height="14" rx="2"\/>/);
  assert.match(script, /function positionPanel\(host\)/);
  assert.match(script, /window\.innerWidth - panel\.offsetWidth/);
  assert.doesNotMatch(script, /top:12px;right:12px/);
  assert.doesNotMatch(script, /toggle\.textContent = "价格表"/);
});

test("price table closes on outside clicks while keeping inside controls open", () => {
  assert.match(script, /document\.addEventListener\("pointerdown", closeOnOutsideClick, true\)/);
  assert.match(script, /document\.addEventListener\("click", closeOnOutsideClick, true\)/);
  assert.match(script, /host\.contains\(event\.target\)/);
  assert.match(script, /host\.classList\.remove\("is-open"\)/);
});

test("price table does not expose the removed Apilio site", () => {
  assert.doesNotMatch(script, /site:\s*"Apilio"/);
});

test("price table keeps Tudou and Grsai Nano Banana 2.1 while omitting Soon 2.1", () => {
  assert.match(script, /if \(provider === "soon"\) return/);
  assert.match(script, /return add\(model, "Nano Banana 2\.1"\)/);
});

test("canvas bundle exposes the live canvas billing calculator", async () => {
  const bundle = await readFile(new URL("assets/index-B2KJ37fm.js", root), "utf8");
  assert.match(bundle, /__vinsenCanvasPriceCalculator/);
  assert.match(bundle, /__vinsenCanvasConfigGetter/);
});
