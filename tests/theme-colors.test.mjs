import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = file => readFile(new URL(`../${file}`, import.meta.url), "utf8");
const bundle = await read("assets/index-B2KJ37fm.js");
const html = await read("index.html");
const theme = await read("theme.css");
const extraCss = (await Promise.all(["canvas-groups.css", "canvas-interaction.css", "startup-entry.css"].map(read))).join("\n");
const styles = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(match => match[1]).join("\n");

test("index.html styles take every color from theme.css", () => {
    const values = [...styles.matchAll(/:([^;{}]*)(?=[;}])/g)].map(match => match[1]);
    const hardCoded = values.filter(value => /#[0-9a-fA-F]{3,8}\b|rgba?\((?!var\()/.test(value));
    assert.deepEqual(hardCoded, []);
    assert.match(html, /<link rel="stylesheet" href="\.\/theme\.css\?v=[^"]+">/);
});

test("theme.css defines every color variable and class the app uses", () => {
    const defined = new Set([...theme.matchAll(/(--lw-[\w-]+)\s*:/g)].map(match => match[1]));
    const referenced = new Set([...(theme + styles).matchAll(/var\((--lw-[\w-]+)\)/g)].map(match => match[1]));
    assert.deepEqual([...referenced].filter(name => !defined.has(name)), []);
    const classes = new Set([...theme.matchAll(/\.(lw-[a-z0-9-]+)/g)].map(match => match[1]));
    const used = new Set([...bundle.matchAll(/(?<![\w-])(lw-[a-z0-9-]+)/g)].map(match => match[1]));
    assert.deepEqual([...used].filter(name => !classes.has(name)), []);
});

// Reads the JS expression after `className:` and returns its string contents.
function classNameText(start) {
    let depth = 0;
    const parts = [];
    for (let i = start; i < bundle.length; i += 1) {
        const char = bundle[i];
        if (char === '"' || char === "'" || char === "`") {
            let j = i + 1;
            while (j < bundle.length && bundle[j] !== char) j += bundle[j] === "\\" ? 2 : 1;
            parts.push(bundle.slice(i + 1, j));
            i = j;
        } else if ("([{".includes(char)) depth += 1;
        else if (")]}".includes(char)) {
            if (depth === 0) break;
            depth -= 1;
        } else if (char === "," && depth === 0) break;
    }
    return parts.join(" ");
}

test("canvas class names do not hard-code colors that ignore dark mode", () => {
    const color = /(?<![\w/-])!?(?:text|bg|border|fill|stroke)-(?:white|black|(?:stone|gray|zinc|neutral|slate|pink|rose|red|emerald|green|amber|yellow|blue|sky|violet|purple|orange|teal|cyan|indigo|lime|fuchsia)-\d{2,3}(?:\/\d+)?|\[#[0-9a-fA-F]{3,8}\])(?![\w-])/;
    const darkScoped = new Set([...(styles + extraCss).matchAll(/\.dark[^{]*?\.([A-Za-z][\w-]+)/g)].map(match => match[1]));
    const offenders = [];
    for (const match of bundle.matchAll(/className:/g)) {
        const text = classNameText(match.index + match[0].length);
        if (!color.test(text) || text.includes("dark:")) continue;
        if (text.split(/\s+/).some(token => darkScoped.has(token))) continue;
        offenders.push(text.slice(0, 120));
    }
    assert.deepEqual(offenders, []);
});

test("the image viewer download button turns black in dark mode", () => {
    assert.match(bundle, /lw-viewer-download"/);
    assert.match(theme, /:root \{[^}]*--lw-viewer-download-text: var\(--color-white\);/);
    assert.match(theme, /\.dark \{[^}]*--lw-viewer-download-text: var\(--lw-black\);/);
});

test("theme.css color variables never reference themselves or form a cycle", () => {
    const blocks = [...theme.matchAll(/(:root|\.dark)\s*\{([^}]*)\}/g)];
    for (const scope of [":root", ".dark"]) {
        const values = new Map();
        for (const [, selector, body] of blocks) {
            if (selector !== ":root" && selector !== scope) continue;
            for (const [, name, value] of body.matchAll(/(--lw-[\w-]+)\s*:\s*([^;]+);/g)) values.set(name, value);
        }
        for (const start of values.keys()) {
            const seen = new Set();
            const walk = name => {
                assert.ok(!seen.has(name), `${scope}: ${start} 循环引用到 ${name}`);
                seen.add(name);
                for (const [, next] of (values.get(name) || "").matchAll(/var\((--lw-[\w-]+)\)/g)) walk(next);
                seen.delete(name);
            };
            walk(start);
        }
    }
});
