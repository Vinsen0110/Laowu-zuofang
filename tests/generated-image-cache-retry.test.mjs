import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

// A generated image is copied into the browser right after it arrives; if that fails the
// node keeps only the provider link, which expires (土豆 links after 24 hours). Two GPT
// results were lost that way on 2026-11-17/18 because a large download hit a flat 60 s cap.
const bundle = await readFile(new URL("../assets/index-B2KJ37fm.js", import.meta.url), "utf8");

function source(start, end) {
    const from = bundle.indexOf(start);
    const to = bundle.indexOf(end, from + start.length);
    assert.ok(from >= 0 && to > from, start);
    return bundle.slice(from, to);
}

test("a slow image download is only abandoned after 60 s without any bytes", async () => {
    const code = source("async function fetchImageBlobWithProgress(", "async function bo(");
    const timers = [];
    const scope = {
        AbortController, Blob, Error, Number,
        setTimeout: (fn, ms) => { timers.push(ms); return timers.length; },
        clearTimeout: () => {},
        fetch: async () => {
            const chunks = [new Uint8Array(3), new Uint8Array(4), new Uint8Array(5)];
            return { ok: true, headers: new Headers({ "content-length": "12" }), body: { getReader: () => ({ read: async () => chunks.length ? { done: false, value: chunks.shift() } : { done: true } }) } };
        },
    };
    const fetchImage = vm.runInNewContext(`${code};fetchImageBlobWithProgress`, scope);
    const progress = [];
    const blob = await fetchImage("https://example.com/a.png", (loaded, total) => progress.push([loaded, total]));
    assert.equal(blob.size, 12);
    assert.deepEqual(progress.at(-1), [12, 12]);
    // The 60 s timer restarts on the response and on every chunk, instead of one flat limit.
    assert.ok(timers.length >= 5 && timers.every((ms) => ms === 60000));
});

test("a failed copy of a remote result is retried twice before the node keeps only its link", async () => {
    const code = source("function cacheCanvasGeneratedImage(", "\nfunction queueCanvasGeneratedImageCache(");
    let calls = 0;
    const scope = {
        Promise, setTimeout, requestAnimationFrame: undefined,
        globalThis: { __lwSetTimeout: (fn) => setTimeout(fn, 0) },
        bo: async () => { calls += 1; if (calls < 3) throw new Error("图片加载超时"); return { url: "blob:x", storageKey: "image:1" }; },
    };
    const cache = vm.runInNewContext(`${code};cacheCanvasGeneratedImage`, scope);
    assert.deepEqual(await cache("https://www.vinsen.top/api/tudou-image?url=x"), { url: "blob:x", storageKey: "image:1" });
    assert.equal(calls, 3);

    calls = -10;
    await assert.rejects(cache("https://example.com/b.png"), /图片加载超时/);
    assert.equal(calls, -7, "three tries in all");

    calls = 0;
    scope.bo = async () => { calls += 1; throw new Error("bad data"); };
    await assert.rejects(cache("data:image/png;base64,AAAA"), /bad data/);
    assert.equal(calls, 1, "inline results are not retried");
});
