import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
    SOON_MAX_REFERENCES,
    SOON_ORIGIN,
    SOON_SITE_MODELS,
    SOON_TEXT_MODELS,
    runSoonImageGeneration,
    soonImagePrice,
    soonImageRequestSpec,
} from "../soon-api.js";

const bundle = await readFile(new URL("../assets/index-B2KJ37fm.js", import.meta.url), "utf8");
const config = { provider: "soon", baseUrl: SOON_ORIGIN, apiKey: "sk-soon_test", model: "soon::nano-banana-pro" };
const json = (body, status = 200) => new Response(JSON.stringify(body), {
    status, headers: { "Content-Type": "application/json" },
});

test("Soon remains image-only while using the native Gemini model endpoint", () => {
    assert.deepEqual(SOON_SITE_MODELS, ["nano-banana-pro"]);
    assert.deepEqual(SOON_TEXT_MODELS, []);
    assert.deepEqual(soonImageRequestSpec({ ...config, size: "16:9", quality: "2K" }, " draw "), {
        endpoint: "/v1beta/models/gemini-3-pro-image:generateContent",
        body: {
            contents: [{ role: "user", parts: [{ text: "draw" }] }],
            generationConfig: {
                responseModalities: ["TEXT", "IMAGE"],
                imageConfig: { aspectRatio: "16:9", imageSize: "2K" },
            },
        },
    });
    assert.equal(soonImagePrice({ ...config, quality: "4K" }), 0.33);
    assert.equal(soonImagePrice({ ...config, quality: "2K" }), 0.24);
    assert.throws(() => soonImageRequestSpec({ ...config, size: "bad" }, "draw"), /不支持比例/);
    assert.throws(() => soonImageRequestSpec(config, "", []), /请输入提示词/);
});

test("Soon sends Gemini native headers, inline reference data, and returns inline images", async () => {
    const calls = [];
    const output = await runSoonImageGeneration(config, "remove the background", [
        "data:image/png;base64,AQID",
    ], {
        fetchImpl: async (url, init) => {
            calls.push({ url, init });
            return json({ candidates: [{ content: { parts: [
                { inlineData: { mimeType: "image/png", data: "BAUG" } },
            ] } }] });
        },
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, `${SOON_ORIGIN}/v1beta/models/gemini-3-pro-image:generateContent`);
    assert.equal(calls[0].init.headers["x-studio-channel-group"], "default");
    assert.equal(calls[0].init.headers["x-studio-request-model"], "gemini-3-pro-image");
    const body = JSON.parse(calls[0].init.body);
    assert.deepEqual(body.contents[0].parts, [
        { text: "remove the background" },
        { inlineData: { mimeType: "image/png", data: "AQID" } },
    ]);
    assert.deepEqual(body.generationConfig, {
        responseModalities: ["TEXT", "IMAGE"],
        imageConfig: { aspectRatio: "1:1", imageSize: "1K" },
    });
    assert.deepEqual(output, ["data:image/png;base64,BAUG"]);
});

test("Soon accepts a remote reference URL by converting it to inlineData", async () => {
    let request;
    const output = await runSoonImageGeneration(config, "use this reference", ["https://example.com/ref.png"], {
        fetchImpl: async (url, init) => {
            if (String(url) === "https://example.com/ref.png") {
                return new Response(Uint8Array.from([7, 8, 9]), { headers: { "Content-Type": "image/png" } });
            }
            request = { url: String(url), init };
            return json({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: "AQI=" } }] } }] });
        },
    });
    assert.equal(request.url, `${SOON_ORIGIN}/v1beta/models/gemini-3-pro-image:generateContent`);
    assert.equal(JSON.parse(request.init.body).contents[0].parts[1].inlineData.data, "BwgJ");
    assert.deepEqual(output, ["data:image/png;base64,AQI="]);
});

test("Soon limits reference count and keeps the compiled Soon route isolated", () => {
    assert.equal(SOON_MAX_REFERENCES, 14);
    assert.match(bundle, /provider:"soon",models:SOON_SITE_MODELS/);
    assert.match(bundle, /r\?\.provider==="soon"\?soonImagePrice\(e\)/);
    assert.match(bundle, /soonReferenceSource/);
    assert.doesNotMatch(bundle, /uploadSoonReferenceBlob/);
});
