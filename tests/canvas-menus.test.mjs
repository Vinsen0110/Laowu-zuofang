import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = file => readFile(new URL(`../${file}`, import.meta.url), "utf8");
const menus = await read("canvas-menus.css");
const html = await read("index.html");
const interaction = await read("canvas-interaction.css");
const MENUS = [".canvas-model-menu", ".canvas-generation-menu", ".canvas-prompt-preset-menu", ".canvas-text-model-menu",
    ".canvas-mention-menu", ".canvas-site-menu", "[data-connection-create-menu]", "[data-canvas-quick-create]"];

test("canvas-menus.css is loaded after the other canvas stylesheets", () => {
    assert.match(html, /canvas-groups\.css\?v=[^"]+">\s*<link rel="stylesheet" href="\.\/canvas-menus\.css\?v=[^"]+">/);
});

test("every canvas dropdown animates in without touching its own transform", () => {
    const rules = [...menus.matchAll(/([^{}]+)\{([^{}]*animation:\s*lw-menu-in[^{}]*)\}/g)].map(match => match[1]);
    for (const menu of MENUS) assert.ok(rules.some(selector => selector.includes(menu)), menu);
    const keyframes = menus.match(/@keyframes lw-menu-in\s*\{([\s\S]*?)\n\}/)[1];
    assert.doesNotMatch(keyframes, /transform\s*:/);
    assert.match(keyframes, /translate:/);
});

test("reduced motion turns menu animation and transitions off", () => {
    const block = menus.slice(menus.indexOf("@media (prefers-reduced-motion: reduce)"));
    for (const menu of MENUS) assert.ok(block.includes(menu), menu);
    assert.match(block, /animation:\s*none !important/);
    assert.match(block, /transition:\s*none !important/);
});

test("the mention menu uses rounded highlighted options and no reserved square scrollbar", () => {
    assert.match(interaction, /\.canvas-mention-option \{[^}]*border-radius:\s*9px/);
    assert.match(interaction, /\.canvas-mention-option\[aria-selected="true"\],\s*\.canvas-mention-option:hover \{[^}]*var\(--lw-mention-option-active-bg\)/);
    assert.doesNotMatch(interaction, /scrollbar-gutter:\s*stable/);
    assert.match(menus, /\.canvas-mention-list[^{]*::-webkit-scrollbar-thumb \{[^}]*border-radius:\s*999px/);
});
