import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const ui = await readFile(new URL("../account-ui.js", import.meta.url), "utf8");

test("the account panel no longer repeats the balance shown on the chip", () => {
    assert.doesNotMatch(ui, /<div class="lw-am-label">余额<\/div>/);
    assert.doesNotMatch(ui, /class="lw-am-amount/);
});

test("admins get no top-up section in the panel or the entry bar", () => {
    assert.match(ui, /\$\{isAdmin \? "" : `<div class="lw-am-sep"><\/div>\s*<div class="lw-am-sec">\s*<div class="lw-am-balance">\s*<div class="lw-am-label">充值<\/div>/);
    assert.match(ui, /\$\{user\.role === "admin" \? "" : `<a class="lw-entry-mini lw-entry-buy"[^`]*<\/a>\s*<button type="button" class="lw-entry-mini" data-act="entry-redeem"[^`]*`\}/);
});
