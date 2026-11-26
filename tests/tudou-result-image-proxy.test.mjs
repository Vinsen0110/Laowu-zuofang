import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// 土豆的结果图（mg.ai-tudou.net）可以用 <img> 显示，但不允许跨域 fetch 读取。
// GPT image 的结果只给链接，画布要 fetch 原图才能存进工程、当参考图上传图床；
// 线上曾经只在本地预览走 /api/tudou-image，导致 GPT 结果图拉线图生图点了没反应。

const indexHtml = await readFile(new URL("../index.html", import.meta.url), "utf8");
const previewServer = await readFile(new URL("../local-preview-server.mjs", import.meta.url), "utf8");

function tudouResultBranch() {
    const start = indexHtml.indexOf("var isTudouResult =");
    assert.notEqual(start, -1, "index.html must still detect 土豆 result images");
    const ifStart = indexHtml.lastIndexOf("if (", start);
    return indexHtml.slice(ifStart, indexHtml.indexOf("} catch (error) {}", start));
}

test("土豆结果图在线上也经由本站服务器读取，不只在本地预览", () => {
    const branch = tudouResultBranch();
    assert.doesNotMatch(branch.slice(0, branch.indexOf("{")), /useLocalTudouProxy/);
    assert.match(branch, /if \(method === "GET" && rawUrl\)/);
    assert.match(branch, /hostedProxyOrigin \+ "\/api\/tudou-image\?url=" \+ encodeURIComponent\(target\.href\)/);
});

test("只代理土豆的结果图，土豆接口本身仍由浏览器直连", () => {
    const branch = tudouResultBranch();
    assert.match(branch, /target\.protocol === "https:"/);
    assert.match(branch, /target\.hostname !== "api\.ai-tudou\.net"/);
    assert.match(branch, /target\.hostname === "ai-tudou\.net" \|\| target\.hostname\.endsWith\("\.ai-tudou\.net"\)/);
    // 接口请求改走 /api/tudou 仍然只限本地预览和桌面版。
    assert.match(indexHtml, /if \(useLocalTudouProxy && rawUrl\) \{\s*try \{\s*var apiTarget/);
});

test("服务器上的 /api/tudou-image 只接受土豆的 https 图片地址", () => {
    assert.match(previewServer, /requestUrl\.pathname === "\/api\/tudou-image"/);
    const start = previewServer.indexOf("async function proxyTudouImage(");
    const body = previewServer.slice(start, previewServer.indexOf("\n}\n", start));
    assert.match(body, /target\.protocol !== "https:"/);
    assert.match(body, /target\.hostname === "ai-tudou\.net" \|\| target\.hostname\.endsWith\("\.ai-tudou\.net"\)/);
    assert.match(body, /target\.hostname === "api\.ai-tudou\.net"/);
});

test("线上土豆香蕉出图（generateContent）经香港服务器转发，其他土豆接口仍直连", () => {
    const start = indexHtml.indexOf("var geminiTarget = new URL(rawUrl, location.href);");
    assert.notEqual(start, -1);
    const branch = indexHtml.slice(indexHtml.lastIndexOf("if (", start), indexHtml.indexOf("} catch (error) {}", start));
    assert.match(branch, /if \(!useLocalTudouProxy && method === "POST" && rawUrl\)/);
    assert.match(branch, /geminiTarget\.hostname === "api\.ai-tudou\.net"/);
    assert.match(branch, /\/\^\\\/v1beta\\\/models\\\/\[\^\/\]\+:generateContent\$\/\.test\(geminiTarget\.pathname\)/);
    assert.match(branch, /hostedProxyOrigin \+ "\/api\/tudou" \+ geminiTarget\.pathname \+ geminiTarget\.search/);
    // 服务器收香蕉请求体放宽到 24 MB（参考图内联）。
    assert.match(previewServer, /readRequestBody\(request, 24 \* 1024 \* 1024\)/);
});

test("土豆结果图允许浏览器缓存，画布量尺寸/显示/存副本只下载一次；出错不缓存", () => {
    // 2026-11-26 线上日志：同一张 GPT 结果图被下载 2～4 遍（原先 no-store），挤占香港到大陆的慢线路。
    const start = previewServer.indexOf("async function proxyTudouImage(");
    const body = previewServer.slice(start, previewServer.indexOf("\n}\n", start));
    assert.match(body, /upstream\.ok \? \{ "Cache-Control": "private, max-age=86400, immutable" \} : \{\}/);
    assert.match(body, /pipeFetchResponse\(upstream, response, \{ "X-Tudou-Image-Proxy": "local-node-stream", \.\.\.cache \}\)/);
    // pipeFetchResponse 先写 no-store，再用 extraHeaders 覆盖，顺序不能反。
    const pipe = previewServer.slice(previewServer.indexOf("async function pipeFetchResponse("));
    assert.ok(pipe.indexOf('"Cache-Control", "no-store"') < pipe.indexOf("Object.entries(extraHeaders)"));
});
