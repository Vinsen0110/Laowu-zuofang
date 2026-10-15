import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const shipped = [
    "assets/index-B2KJ37fm.js",
    "index.html",
    "vercel.json",
    ...(await readdir(root)).filter(name => name.endsWith(".js") || name.endsWith(".mjs")),
    ...(await readdir(new URL("api/", root))).map(name => `api/${name}`),
];

test("shipped files contain no code for the removed Apilio site", async () => {
    for (const file of shipped) {
        const text = await readFile(new URL(file, root), "utf8");
        assert.doesNotMatch(text, /apilio|apollo/i, file);
    }
});
