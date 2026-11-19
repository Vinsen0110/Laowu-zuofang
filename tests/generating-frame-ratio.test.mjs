import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

// While an image generates, its frame takes the chosen ratio instead of waiting for the result.
const bundle = await readFile(new URL("../assets/index-B2KJ37fm.js", import.meta.url), "utf8");

function functionSource(name) {
    const start = bundle.indexOf(`function ${name}(`);
    assert.notEqual(start, -1, `${name} must exist in the shipped bundle`);
    for (let end = bundle.indexOf("}", start); end !== -1; end = bundle.indexOf("}", end + 1)) {
        const candidate = bundle.slice(start, end + 1);
        try {
            new vm.Script(`(${candidate})`);
            return candidate;
        } catch (error) {
            if (!(error instanceof SyntaxError)) throw error;
        }
    }
    throw new Error(`Cannot extract ${name}`);
}

const context = vm.createContext({});
for (const name of ["lwRatioFrame", "lwRatioResize", "createIndependentImageOutputPlan"]) vm.runInContext(functionSource(name), context);
const plain = (value) => JSON.parse(JSON.stringify(value));
let ids = 0;
const plan = (patch) => plain(context.createIndependentImageOutputPlan({
    sourceNodeId: "src", sourceNode: { id: "src", position: { x: 100, y: 100 }, width: 600, height: 400 },
    sourceTemplate: { width: 560, height: 400 }, imageTemplate: { width: 560, height: 400 }, count: 1,
    reuseSourceNode: true, prompt: "p", status: "loading", metadata: { size: "9:16" }, connections: [], imageType: "image",
    createId: () => `n${++ids}`, ...patch,
}));

test("a ratio keeps about the same area and the exact shape; Auto keeps the frame", () => {
    const frame = plain(context.lwRatioFrame("9:16", 600, 400));
    assert.ok(Math.abs(frame.width / frame.height - 9 / 16) < 0.01);
    assert.ok(Math.abs(frame.width * frame.height - 240000) / 240000 < 0.01);
    for (const size of ["auto", "", undefined, "1:20", "abc"]) assert.deepEqual(plain(context.lwRatioFrame(size, 600, 400)), { width: 600, height: 400 }, String(size));
    assert.ok(Math.abs(plain(context.lwRatioFrame("1024x1536", 600, 400)).width / plain(context.lwRatioFrame("1024x1536", 600, 400)).height - 2 / 3) < 0.01);
});

test("regenerating on an image node reshapes it around its centre to the chosen ratio", () => {
    const { primaryOutput } = plan();
    assert.ok(Math.abs(primaryOutput.width / primaryOutput.height - 9 / 16) < 0.01);
    assert.ok(Math.abs(primaryOutput.position.x + primaryOutput.width / 2 - 400) < 1);
    assert.ok(Math.abs(primaryOutput.position.y + primaryOutput.height / 2 - 300) < 1);
});

test("a new output node takes the ratio too; Auto keeps the old behaviour", () => {
    const fresh = plan({ reuseSourceNode: false }).primaryOutput;
    assert.ok(Math.abs(fresh.width / fresh.height - 9 / 16) < 0.01);
    const auto = plan({ metadata: { size: "auto" } }).primaryOutput;
    assert.deepEqual({ ...auto.position, w: auto.width, h: auto.height }, { x: 100, y: 100, w: 600, h: 400 });
});

test("retry reshapes an image node the same way", () => {
    assert.deepEqual(plain(context.lwRatioResize({ position: { x: 0, y: 0 }, width: 400, height: 400 }, "auto")), {});
    const resized = plain(context.lwRatioResize({ position: { x: 0, y: 0 }, width: 400, height: 400 }, "16:9"));
    assert.ok(Math.abs(resized.width / resized.height - 16 / 9) < 0.01);
    assert.match(bundle, /\{\.\.\.en,\.\.\.\(O\.type===Ne\.Image\?lwRatioResize\(en,Se\.size\):\{\}\),metadata:/);
});
