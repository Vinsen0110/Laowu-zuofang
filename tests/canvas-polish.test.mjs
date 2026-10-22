import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const polish = await readFile(new URL("../canvas-polish.js", import.meta.url), "utf8");
const bundle = await readFile(new URL("../assets/index-B2KJ37fm.js", import.meta.url), "utf8");
const html = await readFile(new URL("../index.html", import.meta.url), "utf8");

test("the polish script is loaded and waits for <body>", () => {
    assert.match(html, /<script src="\.\/canvas-polish\.js\?v=[^"]+"><\/script>/);
    assert.match(polish, /if \(document\.body\) start\(\);\s*else document\.addEventListener\("DOMContentLoaded", start, \{ once: true \}\);/);
});

test("an empty canvas offers example prompts that open a ready-to-run image node", () => {
    assert.match(polish, /const hasNodes = document\.querySelector\("\[data-node-id\]"\);/);
    assert.match(polish, /globalThis\.__lwStartFromPrompt\?\.\(chip\.dataset\.prompt\)/);
    assert.match(bundle, /globalThis\.__lwStartFromPrompt=O=>\{Lu\(Ne\.Image,"\\u56FE\\u7247\\u751F\\u6210",Ji\(\),\{content:"",status:rd,prompt:O,/);
});

test("selected nodes get a fine ring instead of the wide glow", () => {
    assert.match(bundle, /,He=\(\(\)=>\{const lwRing=/);
    assert.doesNotMatch(bundle, /0 0 110px rgb\(var\(--lw-pink-brand-rgb\)/);
});

test("the bottom-left switcher names the current channel; the top-left label is gone", () => {
    assert.match(bundle, /className:"canvas-site-switch-button canvas-site-switch-named/);
    assert.match(bundle, /children:y\.jsx\("span",\{className:"canvas-site-switch-name",children:activeSiteName\}\)/);
    assert.match(polish, /\.canvas-site-current-label\{display:none!important\}/);
});

test("toolbar hover tips, the ? shortcut panel and one look for pop-up messages", () => {
    assert.match(polish, /"保存": \["保存工程", `\$\{MOD\} S`\]/);
    assert.match(polish, /event\.key === "\?"/);
    for (const row of ["把选中的图片排成网格", "把选中的节点打包成分组", "拖出一份副本"]) assert.ok(polish.includes(row), row);
    assert.match(polish, /\.ant-message \.ant-message-notice-wrapper\{/);
});

test("tips follow the theme, replace the native title, and a visible ? opens the shortcuts", () => {
    assert.match(polish, /\.dark \.lw-tip\{/);
    assert.match(polish, /button\.dataset\.lwTitle = button\.title; button\.removeAttribute\("title"\);/);
    assert.match(polish, /globalThis\.__lwToggleKeys = \(\) => \{ hideTip\(\); toggleKeys\(\); \};/);
    assert.match(bundle, /y\.jsx\(tg,\{id:"tool-keys",label:"\\u5FEB\\u6377\\u952E",[^}]*onClick:\(\)=>globalThis\.__lwToggleKeys\?\.\(\)/);
});

test("image nodes, uploaded or generated, show the hover toolbar with crop and friends", () => {
    assert.match(bundle, /pv=vc&&!Ye&&!\(QM\(vc\)&&!vc\.metadata\?\.content\)&&Yt===vc\.id\?vc:null/);
    assert.match(bundle, /if\(lwNode\?\.type===Ne\.Image&&lwNode\.metadata\?\.content\)\{Zt\(K\),cv\(K\);return\}/);
    assert.match(bundle, /ge=new Set\(\["reversePrompt","crop","split"\]\)/);
});

test("the settings modal has a single frame on the newer antd markup", () => {
    assert.match(html, /\.laowu-config-modal \.ant-modal-content, \.laowu-config-modal \.ant-modal-container \{\s*overflow: hidden;\s*padding: 0 !important;/);
});

test("only one tooltip: the bundle's own toolbar label is switched off", () => {
    assert.match(bundle, /function Eke\(\{label:e,y:t,theme:n\}\)\{return null;/);
});

test("toasts are a single pill, without antd's outer white box", () => {
    assert.match(polish, /\.ant-message \.ant-message-notice\{padding:0!important;background:transparent!important;box-shadow:none!important;border:0!important\}/);
});

test("node toolbar tips use the theme's text colour instead of antd's white", () => {
    assert.match(bundle, /mouseEnterDelay:\.2,rootClassName:"laowu-node-tip",color:"var\(--lw-tooltip-bg\)"/);
    assert.match(polish, /\.laowu-node-tip \.ant-tooltip-inner,\.laowu-node-tip \.ant-tooltip-container\{color:var\(--lw-tooltip-text\)!important/);
});

test("the left toolbar has no undo button (Cmd+Z still works)", () => {
    assert.doesNotMatch(bundle, /id:"tool-undo"/);
});
