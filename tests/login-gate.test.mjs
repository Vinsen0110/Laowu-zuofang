import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const ui = await readFile(new URL("../account-ui.js", import.meta.url), "utf8");

test("the start screen is covered by the split entry page once the account state is known; opening a project removes it", () => {
    assert.match(ui, /const gated = Boolean\(workspace\) && loaded;/);
    assert.match(ui, /if \(!gated && gate\) \{ gate\.remove\(\); gate = null; \}/);
    assert.match(ui, /const target = gated \? gateSide\(\) : workspace;/);
});

test("the sign-in page keeps the same forms and shows Kitty silhouettes on white", () => {
    assert.match(ui, /<h1>一张无限画布，<br>把想法变成图片<\/h1>/);
    assert.match(ui, /mode === "register" \? "创建账号" : mode === "reset" \? "找回密码" : "欢迎回来"/);
    assert.match(ui, /\.lw-gate-kitties i\{[^}]*mask:url\(\.\/kitty\.png\)/);
    assert.match(ui, /\.lw-gate-kitties\{position:absolute;inset:0;z-index:-1;overflow:hidden;pointer-events:none\}/);
});

test("the artwork side is a tilted drifting wall of the sixteen showcase pictures that ship with the site", async () => {
    const { access } = await import("node:fs/promises");
    assert.match(ui, /<div class="lw-gate-wall">\$\{col\(0\)\}\$\{col\(1\)\}\$\{col\(4\)\}\$\{col\(7\)\}<\/div>/);
    const names = ui.match(/const GATE_SLIDES = \[([^\]]+)\]/)[1].match(/"([^"]+)"/g).map((n) => n.slice(1, -1));
    assert.equal(names.length, 16);
    for (const n of names) await access(new URL(`../login/${n}.jpg`, import.meta.url));
});

test("signed-in visitors see their avatar, balance and the project buttons; admins keep the admin link", () => {
    assert.match(ui, /if \(user && gate\) \{/);
    assert.match(ui, /<div class="lw-gate-me lw-gate-center">/);
    assert.match(ui, /data-act="project-blank"/);
    assert.match(ui, /data-act="project-import"/);
    assert.match(ui, /document\.querySelector\(`\.startup-entry \[data-project-action="\$\{act === "project-blank" \? "blank" : "import"\}"\]`\)\?\.click\(\);/);
    assert.match(ui, /\$\{isAdmin \? `<a href="\/admin\.html" target="_blank" rel="noopener">管理后台 ↗<\/a>` : ""\}/);
});

test("the last account on this device is offered after sign-out: avatar, name and a password box", () => {
    assert.match(ui, /const LAST_ACCOUNT_KEY = "lw-last-account";/);
    assert.match(ui, /if \(next\) \{ rememberAccount\(next\); useOtherAccount = false; \}/);
    assert.match(ui, /<input type="hidden" name="email" value="\$\{esc\(last\.email\)\}">/);
    assert.match(ui, /data-act="use-other">使用其他账号<\/button>/);
});
