import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

// 2026-11-26：用户在生成中刷新/关页面，一次丢了 4 张和 7 张（已扣费、页面没机会退款）。
// 有节点在生成或余额转发请求未结束时，离开页面要先让浏览器确认。

const indexHtml = await readFile(new URL("../index.html", import.meta.url), "utf8");

function guard(context) {
    const marker = 'window.addEventListener("beforeunload"';
    const start = indexHtml.lastIndexOf("(function () {", indexHtml.indexOf(marker));
    const end = indexHtml.indexOf("})();", start) + "})();".length;
    let handler = null;
    context.window = { addEventListener: (name, fn) => { if (name === "beforeunload") handler = fn; }, __lwRelay: context.__lwRelay };
    context.globalThis = context;
    vm.runInNewContext(indexHtml.slice(start, end), context);
    const event = { prevented: false, preventDefault() { this.prevented = true; } };
    handler(event);
    return event.prevented;
}

const canvasWith = (...statuses) => () => ({ nodes: statuses.map((status, i) => ({ id: String(i), metadata: { status } })) });

test("有节点在生成时离开页面要确认", () => {
    assert.equal(guard({ __laowuUnsavedCanvas: canvasWith("success", "loading") }), true);
});

test("余额转发请求没结束时离开页面要确认", () => {
    assert.equal(guard({ __laowuUnsavedCanvas: canvasWith("success"), __lwRelay: { inflight: 1 } }), true);
});

test("没有在生成时不打扰", () => {
    assert.equal(guard({ __laowuUnsavedCanvas: canvasWith("success", "error"), __lwRelay: { inflight: 0 } }), false);
    assert.equal(guard({}), false);
});
