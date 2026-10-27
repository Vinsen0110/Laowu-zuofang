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

function timeoutHelper() {
    const source = block("function withCanvasImageTimeout(", "function ig(");
    return vm.runInNewContext(`${source};withCanvasImageTimeout`, { AbortController, Promise, Error, Math, setTimeout, clearTimeout });
}

function taskRegistry() {
    const scope = {
        c: { useCallback: fn => fn },
        Sa: { current: new Map() }, AbortController,
        running: new Set(),
        nodes: [],
        ua: "running", rd: "stopped",
    };
    scope.setRunningNodeIds = ids => { scope.running = ids; };
    scope._ = update => { scope.nodes = update(scope.nodes); };
    vm.runInNewContext(`var syncRunningNodeIds,Ca,Xo,pf;${block("syncRunningNodeIds=c.useCallback", ",lv=c.useCallback")}`, scope);
    return scope;
}

test("a canvas image request that never answers fails after the timeout", async () => {
    const withTimeout = timeoutHelper();
    let child;
    await assert.rejects(withTimeout(new AbortController().signal, signal => {
        child = signal;
        return new Promise(() => {});
    }, 20), /生成超时/);
    assert.equal(child.aborted, true);
    assert.equal(child.reason.lwCanvasTimeout, true);
    assert.equal(await withTimeout(undefined, async () => "image", 1000), "image");
});

test("土豆 refunds a request the canvas gave up on, but not one the user stopped", async () => {
    const refunds = [];
    const lwTudouDirect = vm.runInNewContext(`${block("async function lwTudouDirect(", "\nasync function tudouGeminiStreamImages(")};lwTudouDirect`, {
        globalThis: { __lwDirectCharge: async () => "charge-ref", __lwDirectRefund: ref => refunds.push(ref) },
    });
    const aborted = () => Promise.reject(new DOMException("aborted", "AbortError"));
    const stopped = new AbortController();
    stopped.abort();
    await assert.rejects(lwTudouDirect({ apiKey: "key" }, "url", {}, aborted, stopped.signal));
    assert.deepEqual(refunds, []);

    const timedOut = new AbortController();
    timedOut.abort(Object.assign(new Error("timeout"), { lwCanvasTimeout: true }));
    await assert.rejects(lwTudouDirect({ apiKey: "key" }, "url", {}, aborted, timedOut.signal));
    assert.deepEqual(refunds, ["charge-ref"]);
});

test("stopping the canvas task still aborts the wrapped request", async () => {
    const withTimeout = timeoutHelper();
    const parent = new AbortController();
    let child;
    const pending = withTimeout(parent.signal, signal => new Promise((_, reject) => {
        child = signal;
        signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    }), 1000);
    parent.abort();
    await assert.rejects(pending, error => error.name === "AbortError");
    assert.equal(child.aborted, true);
});

test("every canvas image request goes through the timeout", () => {
    assert.doesNotMatch(bundle, /await (P0|DL)\(/);
    assert.equal(bundle.match(/await withCanvasImageTimeout\([A-Za-z]+\.signal,lwSignal=>(P0|DL)\(/g)?.length, 6);
});

test("a node stays 停止 until its task ends, and stop works from any node of the task", () => {
    const scope = taskRegistry();
    const controller = scope.Ca("source", "source", "source");
    scope.Ca("output", "source", "source", controller);
    assert.deepEqual([...scope.running].sort(), ["output", "source"]);

    scope.Xo("output", controller);
    assert.deepEqual([...scope.running], ["source"]);

    scope.Ca("output", "source", "source", controller);
    scope.nodes = [{ id: "output", metadata: { status: "running" } }];
    scope.pf("output");
    assert.equal(controller.signal.aborted, true);
    assert.equal(scope.Sa.current.size, 0);
    assert.equal(scope.running.size, 0);
    assert.equal(scope.nodes[0].metadata.status, "stopped");
});

test("panels read the per-node running state and a busy click says why", () => {
    assert.match(bundle, /\[Dt,setRunningNodeIds\]=c\.useState\(\(\)=>new Set\)/);
    assert.equal(bundle.match(/isRunning:Dt\.has\(K\.id\)/g)?.length, 2);
    assert.match(bundle, /di=c\.useCallback\(async\(O,K,Q\)=>\{if\(Sa\.current\.has\(O\)\)\{e\.warning\(/);
    assert.match(bundle, /const Tf=c\.useCallback\(async O=>\{if\(Sa\.current\.has\(O\.id\)\)\{e\.warning\(/);
});
