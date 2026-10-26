import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
    fetchApiMartResultImage,
    isApiMartResultImageUrl,
} from "../apimart-result-image.js";

const indexHtml = await readFile(new URL("../index.html", import.meta.url), "utf8");
const previewServer = await readFile(new URL("../local-preview-server.mjs", import.meta.url), "utf8");
const vercelConfig = JSON.parse(await readFile(new URL("../vercel.json", import.meta.url), "utf8"));

test("APIMart result proxy accepts only the documented result host family", () => {
    assert.equal(isApiMartResultImageUrl("https://getapib.org/f/images/result.png"), true);
    assert.equal(isApiMartResultImageUrl("https://cdn.getapib.org/f/images/result.png"), true);
    assert.equal(isApiMartResultImageUrl("https://upload.apimart.ai/images/result.png"), true);
    assert.equal(isApiMartResultImageUrl("https://cdn.upload.apimart.ai/images/result.png"), true);
    assert.equal(isApiMartResultImageUrl("http://getapib.org/f/images/result.png"), false);
    assert.equal(isApiMartResultImageUrl("https://getapib.org.evil.example/result.png"), false);
    assert.equal(isApiMartResultImageUrl("https://127.0.0.1/result.png"), false);
});

test("APIMart result proxy returns only successful image responses", async () => {
    const response = await fetchApiMartResultImage("https://getapib.org/f/images/result.png", {
        fetchImpl: async (_url, init) => {
            assert.equal(init.redirect, "manual");
            assert.equal(init.headers.Accept, "image/*");
            return new Response(Uint8Array.from([1, 2, 3]), {
                headers: { "Content-Type": "image/png" },
            });
        },
    });
    assert.equal(response.headers.get("content-type"), "image/png");

    await assert.rejects(
        fetchApiMartResultImage("https://getapib.org/f/images/error", {
            fetchImpl: async () => new Response("error", { status: 502 }),
        }),
        /request failed \(502\)/,
    );
    await assert.rejects(
        fetchApiMartResultImage("https://getapib.org/f/images/html", {
            fetchImpl: async () => new Response("<html></html>", {
                headers: { "Content-Type": "text/html" },
            }),
        }),
        /did not return an image/,
    );
});

test("Mart results (getapib.org) download directly; only upload.apimart.ai goes through the image proxy", () => {
    assert.doesNotMatch(indexHtml, /imageTarget\.hostname === "getapib\.org"/);
    assert.match(indexHtml, /imageTarget\.hostname === "upload\.apimart\.ai"/);
    assert.match(indexHtml, /\/api\/apimart-image\?url=/);
    assert.match(previewServer, /requestUrl\.pathname === "\/api\/apimart-image"/);
    assert.equal(vercelConfig.functions["api/apimart-image.js"].maxDuration, 60);
});
