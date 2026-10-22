import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const bundle = await readFile(new URL("../assets/index-B2KJ37fm.js", import.meta.url), "utf8");

test("copying a node that is still generating gives an idle copy, for text nodes too", () => {
    const start = bundle.indexOf("function sanitizeCanvasNodeClone(e){");
    const body = bundle.slice(start, bundle.indexOf("function zc(", start));
    const sanitize = new Function("Ne", "ua", "rd", `${body}; return sanitizeCanvasNodeClone;`)({ Image: "image", Text: "text" }, "loading", "idle");
    const text = sanitize({ type: "text", position: { x: 0, y: 0 }, metadata: { status: "loading", prompt: "拆解这张图", generationStartedAt: "t" } });
    assert.equal(text.metadata.status, "idle");
    assert.equal(text.metadata.prompt, "拆解这张图");
    assert.equal(text.metadata.generationStartedAt, undefined);
    const image = sanitize({ type: "image", position: { x: 0, y: 0 }, metadata: { status: "loading", content: "x" } });
    assert.equal(image.metadata.status, "idle");
    assert.equal(image.metadata.content, "");
    const done = sanitize({ type: "text", position: { x: 0, y: 0 }, metadata: { status: "success", content: "结果" } });
    assert.equal(done.metadata.status, "success");
});
