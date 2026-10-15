import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const bundle = await readFile(new URL("../assets/index-B2KJ37fm.js", import.meta.url), "utf8");
const assetKey = "infinite-canvas:asset_store";

function assetAdapter(assets, overrides = {}) {
    const writes = [];
    const value = JSON.stringify({ state: { assets }, version: 0 });
    const start = bundle.indexOf("B$e={hydratedAssets:");
    const end = bundle.indexOf(",gs=fh()", start);
    assert.ok(start >= 0 && end > start);
    const context = {
        Lm: {
            getItem: async () => value,
            setItem: async (key, text) => { writes.push({ key, text }); },
            removeItem: async () => {},
        },
        Xl: async key => `blob:current-image-${key}`,
        Og: async key => `blob:current-video-${key}`,
        bo: async () => ({
            storageKey: "image:migrated", url: "blob:migrated",
            bytes: 10, mimeType: "image/png",
        }),
        ...overrides,
    };
    const adapter = vm.runInNewContext(`const ${bundle.slice(start, end)};B$e`, context);
    return { adapter, writes, value };
}

test("asset hydration restores runtime URLs without persisting hydration-only changes", async () => {
    const assets = [
        { id: "image", kind: "image", coverUrl: "blob:old-image", data: { storageKey: "image:one", dataUrl: "blob:old-image" } },
        { id: "video", kind: "video", coverUrl: "", data: { storageKey: "video:one", url: "blob:old-video" } },
        { id: "text", kind: "text", coverUrl: "", data: { content: "Keep text" } },
    ];
    for (let tab = 0; tab < 2; tab++) {
        const { adapter, writes } = assetAdapter(assets);
        const hydrated = await adapter.getItem(assetKey);
        assert.equal(hydrated.state.assets[0].data.dataUrl, "blob:current-image-image:one");
        assert.equal(hydrated.state.assets[1].data.url, "blob:current-video-video:one");
        await adapter.setItem(assetKey, { state: { assets: hydrated.state.assets }, version: 0 });
        assert.equal(writes.length, 0);
        await adapter.setItem(assetKey, {
            state: { assets: hydrated.state.assets.map(asset => ({ ...asset, title: "Edited" })) },
            version: 0,
        });
        assert.equal(writes.length, 1);
        assert.equal(JSON.parse(writes[0].text).state.assets[0].title, "Edited");
    }
});

test("legacy data-image conversion still persists new durable storage keys", async () => {
    const { adapter, writes } = assetAdapter([
        { id: "legacy", kind: "image", coverUrl: "data:image/png;base64,A", data: { dataUrl: "data:image/png;base64,A" } },
    ]);
    const hydrated = await adapter.getItem(assetKey);
    await adapter.setItem(assetKey, hydrated);
    assert.equal(writes.length, 1);
    assert.equal(JSON.parse(writes[0].text).state.assets[0].data.storageKey, "image:migrated");
});

test("failed durable image conversion preserves legacy data without a hydration rewrite", async () => {
    const source = "data:image/png;base64,A";
    const { adapter, writes, value } = assetAdapter([
        { id: "legacy", kind: "image", coverUrl: source, data: { dataUrl: source } },
    ], { bo: async () => ({ storageKey: "", url: source, bytes: 10, mimeType: "image/png" }) });
    const hydrated = await adapter.getItem(assetKey);
    await adapter.setItem(assetKey, hydrated);
    assert.equal(writes.length, 0);
    assert.equal(JSON.parse(value).state.assets[0].data.dataUrl, source);
});

function cleanupHarness(error) {
    const events = [];
    let scheduled;
    const start = bundle.indexOf("cleanupImages:n=>") + "cleanupImages:".length;
    const end = bundle.indexOf("},0)}", start) + "},0)}".length;
    assert.ok(start >= "cleanupImages:".length && end > start);
    const context = {
        window: { setTimeout: callback => { scheduled = callback; } },
        ENe: { flush: async () => { events.push("flush"); if (error) throw error; } },
        uq: async callback => callback(),
        $Ne: { useCanvasStore: { getState: () => ({ projects: [] }) } },
        t: () => ({ assets: [] }),
        cq: async () => { events.push("images"); },
        D$e: async () => { events.push("media"); },
        showStorageError: failure => { events.push(failure); },
    };
    const source = bundle.slice(start, end).replaceAll("import.meta.url", JSON.stringify(import.meta.url));
    const cleanup = vm.runInNewContext(`(${source})`, context);
    return { events, run: async () => { cleanup({ assets: [] }); await scheduled(); } };
}

test("asset cleanup waits for app persistence before deleting image or media blobs", async () => {
    const { events, run } = cleanupHarness();
    await run();
    assert.deepEqual(events, ["flush", "images", "media"]);
});

test("asset cleanup reports persistence failure and preserves every blob", async () => {
    const error = Object.assign(new Error("Newer state belongs to another tab"), { name: "StorageConflictError" });
    const { events, run } = cleanupHarness(error);
    await run();
    assert.deepEqual(events, ["flush", error]);
});

test("canvas edits are not autosaved to browser storage", () => {
    assert.ok(!bundle.includes(
        "c.useEffect(()=>{!We||!Me||x.current||I(a,{nodes:B,connections:X,chatSessions:ne,activeChatId:te,backgroundMode:Te,showImageInfo:It})},[te,Te,ne,X,B,a,We,Me,It,I])",
    ));
});

test("canvas edits are not autosaved to the local project directory", () => {
    assert.ok(!bundle.includes("Zi.current=setTimeout(()=>{Zi.current=null,zs(!1,!0)},700)"));
});

test("canvas viewport changes are not autosaved", () => {
    assert.ok(!bundle.includes(
        "c.useEffect(()=>{if(We&&Me)return v.current&&clearTimeout(v.current),v.current=setTimeout(()=>{I(a,{viewport:Ao.current}),v.current=null},500),()=>{v.current&&clearTimeout(v.current)}},[a,We,Me,I,oe])",
    ));
});

test("manual save persists the canvas and marks it saved", () => {
    assert.ok(bundle.includes("Th=c.useCallback(async(O=!0)=>{const K=$.current;I(a,{nodes:vn.current,connections:Jr.current,"));
    assert.ok(bundle.includes('if(le&&!K.altKey&&Q==="s"){K.preventDefault(),Th(!0);return}'));
    assert.ok(bundle.includes("onSave:()=>Th(!0)"));
});

test("leaving with unsaved canvas changes asks for confirmation", () => {
    assert.ok(bundle.includes('const O=K=>{$.current!==j.current&&(K.preventDefault(),K.returnValue="")};return window.addEventListener("beforeunload",O)'));
});

function imageCleanup(storedKeys) {
    const start = bundle.indexOf("async function cq(");
    const end = bundle.indexOf("function P$e(", start);
    assert.ok(start >= 0 && end > start);
    const deleted = [];
    const context = {
        yh: { iterate: async visit => { for (const key of storedKeys) visit(null, key); } },
        lq: async keys => { deleted.push(...keys); },
    };
    const cleanup = vm.runInNewContext(`${bundle.slice(start, end)};cq`, context);
    return { cleanup, deleted };
}

test("asset and chat cleanup keep images that only exist in the unsaved canvas", async () => {
    assert.ok(bundle.includes("const unsaved=globalThis.__laowuUnsavedCanvas?.();await cq({assets:t().assets,projects:r.getState().projects,extra:n,unsaved}),await D$e({assets:t().assets,projects:r.getState().projects,extra:n,unsaved})"));
    assert.ok(bundle.includes("const unsaved=()=>({nodes:vn.current,chatSessions:ne,history:m.current,lastHistory:h.current});globalThis.__laowuUnsavedCanvas=unsaved;"));

    const { cleanup, deleted } = imageCleanup(["image:saved", "image:unsaved", "image:undo", "image:orphan"]);
    await cleanup({
        assets: [],
        projects: [{ nodes: [{ metadata: { storageKey: "image:saved" } }] }],
        extra: { sessions: [] },
        unsaved: {
            nodes: [{ metadata: { storageKey: "image:unsaved" } }],
            chatSessions: [],
            history: { past: [{ nodes: [{ metadata: { storageKey: "image:undo" } }] }], future: [] },
            lastHistory: null,
        },
    });
    assert.deepEqual(deleted, ["image:orphan"]);
});
