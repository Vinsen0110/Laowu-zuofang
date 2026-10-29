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

test("replacing clears the old generation and remote-cache state", () => {
    const replace = block("_u=c.useCallback(async(O,K)=>{", ",Fh=c.useCallback(");
    for (const field of ["generationType:void 0", "model:void 0", "prompt:void 0", "generationStage:void 0",
        "remoteSourceUrl:void 0", "localCacheStatus:void 0", "localPromptPresetId:void 0"]) {
        assert.ok(replace.includes(field), field);
    }
    // Image-generation nodes and generated images (titled with their prompt) become 图片输入.
    assert.match(replace, /title:QM\(Se\)\?"\\u56FE\\u7247\\u8F93\\u5165":Se\.title\|\|K\.name/);
});
