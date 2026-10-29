import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const bundle = await readFile(new URL("../assets/index-B2KJ37fm.js", import.meta.url), "utf8");

function block(start, end) {
    const from = bundle.indexOf(start);
    const to = bundle.indexOf(end, from + start.length);
    assert.ok(from >= 0 && to > from, start);
    return bundle.slice(from, to);
}

const Ne = { Image: "image", Text: "text", Video: "video" };
const dropTarget = vm.runInNewContext(`${block("function Kke(", "function a$(")};Kke`, { Ne, ua: "loading" });

function node(id, metadata = {}, extra = {}) {
    return { id, type: Ne.Image, title: "图片输入", position: { x: 0, y: 0 }, width: 100, height: 100, metadata, ...extra };
}

const at = { x: 50, y: 50 };

test("an image dropped on an image-generation node or a generated image replaces it", () => {
    const generation = node("gen", { content: "", status: "idle", model: "nano" }, { title: "图片生成" });
    assert.equal(dropTarget([generation], at)?.id, "gen");
    const generated = node("out", { content: "blob:x", status: "success", generationType: "generation" }, { title: "图片生成" });
    assert.equal(dropTarget([generated], at)?.id, "out");
    assert.equal(dropTarget([node("input", { content: "" })], at)?.id, "input");
});

test("busy nodes, batch images and nodes outside the pointer are not replaced", () => {
    assert.equal(dropTarget([node("loading", { status: "loading" }, { title: "图片生成" })], at), null);
    assert.equal(dropTarget([node("running", { status: "idle" })], at, id => id === "running"), null);
    assert.equal(dropTarget([node("root", { isBatchRoot: true, batchChildIds: ["c"] })], at), null);
    assert.equal(dropTarget([node("child", { batchRootId: "root" })], at), null);
    assert.equal(dropTarget([node("far", {}, { position: { x: 500, y: 500 } })], at), null);
    assert.equal(dropTarget([{ ...node("text"), type: Ne.Text }], at), null);
});

test("the topmost eligible image node wins", () => {
    const nodes = [node("below"), node("above"), node("busy", { status: "loading" })];
    assert.equal(dropTarget(nodes, at)?.id, "above");
});

test("only a single dropped image replaces a node; several files become new nodes", () => {
    const handler = block("Wh=c.useCallback(O=>{O.preventDefault();", ",ts=c.useCallback(");
    const calls = [];
    const scope = {
        c: { useCallback: fn => fn }, gm: () => false, or: (x, y) => ({ x, y }),
        vn: { current: [node("gen", { status: "idle" }, { title: "图片生成", position: { x: 0, y: 0 } })] },
        Sa: { current: new Map() }, Dt: new Set(),
        Kke: dropTarget,
        _u: (id, file) => calls.push(["replace", id, file.name]),
        Ea: (files) => calls.push(["create", files.map(f => f.name)]),
    };
    const drop = vm.runInNewContext(`(${handler.replace(/^Wh=c\.useCallback\(/, "").replace(/,\[[^\]]*\]\)$/, "")})`, scope);
    const file = (name, type = "image/png") => ({ name, type });
    const event = files => ({ preventDefault() {}, clientX: 50, clientY: 50, dataTransfer: { files } });

    drop(event([file("one.png")]));
    drop(event([file("a.png"), file("b.png")]));
    scope.Dt = new Set(["gen"]);
    drop(event([file("busy.png")]));
    assert.deepEqual(JSON.parse(JSON.stringify(calls)), [["replace", "gen", "one.png"], ["create", ["a.png", "b.png"]], ["create", ["busy.png"]]]);
});

function replaceNodeImage() {
    const source = `${block("function QM(", "function Kke(")}${block("function replaceNodeImage(", "function a$(")}`;
    const Qa = image => ({ content: image.url, storageKey: image.storageKey, status: "success", naturalWidth: image.width, naturalHeight: image.height, bytes: image.bytes, mimeType: image.mimeType });
    return vm.runInNewContext(`${source};replaceNodeImage`, { Ne, Qa });
}

const image = { url: "blob:new", storageKey: "image:new", width: 3000, height: 2000, bytes: 127381, mimeType: "image/png" };
const size = { width: 600, height: 400 };
const plain = value => JSON.parse(JSON.stringify(value));

test("an image-generation node keeps its prompt and settings when an image is dropped on it", () => {
    const replace = replaceNodeImage();
    const generation = node("gen", { content: "", status: "idle", prompt: "左右延伸", model: "tudou::nano-banana-pro", size: "3:2", quality: "2k", gptImageQuality: "high", count: 1, localPromptPresetId: "p1", imageGenerationDraft: { size: "16:9" } }, { title: "图片生成" });
    const result = plain(replace(generation, image, size, "drop.png"));
    assert.equal(result.title, "图片生成");
    assert.equal(result.metadata.content, "blob:new");
    assert.equal(result.metadata.storageKey, "image:new");
    assert.equal(result.metadata.bytes, 127381);
    for (const [key, value] of Object.entries({ prompt: "左右延伸", model: "tudou::nano-banana-pro", size: "3:2", quality: "2k", gptImageQuality: "high", count: 1, localPromptPresetId: "p1" })) {
        assert.equal(result.metadata[key], value, key);
    }
    assert.deepEqual(result.metadata.imageGenerationDraft, { size: "16:9" });
});

test("a generated image stays an image-generation node with its prompt, without the old result state", () => {
    const replace = replaceNodeImage();
    const generated = node("out", { content: "blob:old", status: "success", generationType: "edit", prompt: "旧提示词", model: "nano", references: ["image:ref"], generatedAt: "t", remoteSourceUrl: "https://x/y.png", localCacheStatus: "pending", localAssetPath: "生成图/图片1.png" }, { title: "旧提示词" });
    const result = plain(replace(generated, image, size, "drop.png"));
    assert.equal(result.title, "图片生成");
    assert.equal(result.metadata.prompt, "旧提示词");
    assert.equal(result.metadata.model, "nano");
    for (const key of ["generationType", "references", "generatedAt", "remoteSourceUrl", "localCacheStatus", "localAssetPath"]) {
        assert.equal(result.metadata[key], undefined, key);
    }
});

test("an input node stays an input node", () => {
    const replace = replaceNodeImage();
    const input = node("in", { content: "blob:old", storageKey: "image:old" }, { title: "我的图" });
    const result = plain(replace(input, image, size, "drop.png"));
    assert.equal(result.title, "我的图");
    assert.equal(result.metadata.content, "blob:new");
    assert.equal(result.metadata.prompt, undefined);
    assert.equal(plain(replace(node("in2", {}, { title: "" }), image, size, "drop.png")).title, "drop.png");
});
