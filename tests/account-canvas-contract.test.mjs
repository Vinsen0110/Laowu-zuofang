import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const bundle = await readFile(new URL("../assets/index-B2KJ37fm.js", import.meta.url), "utf8");
const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const accountUi = await readFile(new URL("../account-ui.js", import.meta.url), "utf8");

test("relay requests carry a masked target, never the supplier URL", () => {
    assert.match(html, /"\/api\/account\/relay\?t=" \+ maskTarget\(/);
    assert.doesNotMatch(html, /relay\?url=/);
});

test("the 固定/官方 selector only shows when there is more than one mode", () => {
    const uses = bundle.match(/APIMART_GPT_MODE_OPTIONS(?!=)/g) || [];
    const guarded = bundle.match(/APIMART_GPT_MODE_OPTIONS\.length>1/g) || [];
    // every render site is guarded (definitions and the guards themselves aside)
    assert.equal(guarded.length, 5);
    assert.ok(uses.length >= 10);
});

test("admins get no 图床 page; users get a refund hint on failures", () => {
    assert.match(bundle, /globalThis\.__lwIsAdmin===true\?null:y\.jsx\(nL,\{active:t==="hosting"/);
    assert.match(bundle, /globalThis\.__lwIsAdmin===true\|\|\/已退回\/\.test\(e\.metadata\?\.errorDetails\|\|""\)\?null:y\.jsx\("div",\{className:"canvas-refund-hint"/);
});

test("account chip: no focus refresh, no ledger for users, logout guard", () => {
    assert.doesNotMatch(accountUi, /addEventListener\("focus"/);
    // Users still see a balance the admin changed: on returning to the tab and once a minute.
    assert.match(accountUi, /if \(!user \|\| user\.role === "admin" \|\| document\.visibilityState !== "visible"\) return;/);
    assert.match(accountUi, /document\.addEventListener\("visibilitychange", \(\) => recheckBalance\(10_000\)\);/);
    assert.match(accountUi, /\$\{isAdmin \? `<div class="lw-am-sep"><\/div>\s*<div class="lw-am-sec">\s*<div class="lw-am-label">最近记录/);
    assert.match(accountUi, /还有图片正在生成/);
});

test("background tabs keep polling at full speed; badge stays out of the image viewer", () => {
    assert.match(html, /window\.__lwSetTimeout = function/);
    assert.match(bundle, /const o=\(globalThis\.__lwSetTimeout\|\|setTimeout\)\(n,e\)/);
    assert.match(html, /body:has\(\.canvas-image-viewer\) \.lw-acct,/);
    assert.match(html, /body:has\(\.ant-modal-wrap:not\(\[style\*="display: none"\]\) \.laowu-config-modal\) \.lw-acct \{ display: none !important; \}/);
    assert.match(accountUi, /placeChipLater\(\);/);
});
