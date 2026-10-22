import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const ui = await readFile(new URL("../account-ui.js", import.meta.url), "utf8");

test("signed-out visitors get the split sign-in page; signing in removes it", () => {
    assert.match(ui, /const gated = Boolean\(workspace\) && loaded && !user;/);
    assert.match(ui, /if \(!gated && gate\) \{ gate\.remove\(\); gate = null; \}/);
    assert.match(ui, /const target = gated \? gateSide\(\) : workspace;/);
});

test("the sign-in page keeps the same forms and shows Kitty silhouettes on white", () => {
    assert.match(ui, /<h1>一张无限画布，<br>把想法变成图片<\/h1>/);
    assert.match(ui, /mode === "register" \? "创建账号" : mode === "reset" \? "找回密码" : "欢迎回来"/);
    assert.match(ui, /\.lw-gate-kitties i\{[^}]*mask:url\(\.\/kitty\.png\)/);
    assert.match(ui, /\.lw-gate-kitties\{position:absolute;inset:0;z-index:-1;overflow:hidden;pointer-events:none\}/);
});
