import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const bundle = await readFile(new URL("../assets/index-B2KJ37fm.js", import.meta.url), "utf8");
const start = bundle.indexOf("const LW_SUPPLIER_NAMES=");
const end = bundle.indexOf("const lwAppCache=");
const scrub = new Function("globalThis", "location", `${bundle.slice(start, end)}; return lwScrubText;`);

test("users see channel labels instead of supplier names and links in errors", () => {
    const lwScrubText = scrub({ __lwIsAdmin: false }, { host: "test.vinsen.top" });
    assert.equal(lwScrubText("RH 请求失败（HTTP 402）"), "渠道 4 请求失败（HTTP 402）");
    assert.equal(lwScrubText("Tudou 流式响应格式异常"), "渠道 1 流式响应格式异常");
    assert.equal(lwScrubText("Grsai 图片生成超时"), "渠道 3 图片生成超时");
    assert.equal(lwScrubText("Soon 没有返回 task_id"), "渠道 5 没有返回 task_id");
    assert.equal(lwScrubText("APIMart: see https://api.apimart.ai/x"), "渠道 2: see [链接已隐藏]");
    assert.equal(lwScrubText("please retry soon, smart RHINO"), "please retry soon, smart RHINO");
});

test("admins keep the original text, and every toast goes through the scrubber", () => {
    const lwScrubText = scrub({ __lwIsAdmin: true }, { host: "test.vinsen.top" });
    assert.equal(lwScrubText("RH 请求失败"), "RH 请求失败");
    assert.match(bundle, /As\.useApp=\(\)=>lwScrubbedApp\(sle\(\)\)/);
    assert.match(bundle, /children:lwScrubText\(e\.metadata\?\.errorDetails\)/);
});
