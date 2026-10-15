import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

// 土豆允许浏览器直接跨域请求（预检回 access-control-allow-origin: *，
// access-control-allow-headers: *），所以请求走浏览器直连，不再经过 Vercel 的
// /api/tudou 代理。这样图片和流式响应不占用 Fast Origin Transfer 额度。
// 这个文件锁死该行为，防止以后又被改回代理。

const bundle = await readFile(new URL("../assets/index-B2KJ37fm.js", import.meta.url), "utf8");
const inliner = await readFile(new URL("../tudou-reference-images.js", import.meta.url), "utf8");

function functionSource(name) {
    let start = bundle.indexOf(`function ${name}(`);
    assert.notEqual(start, -1, `missing ${name}`);
    if (bundle.slice(start - 6, start) === "async ") start -= 6;
    for (let end = bundle.indexOf("}", start); end !== -1; end = bundle.indexOf("}", end + 1)) {
        const candidate = bundle.slice(start, end + 1);
        try { new vm.Script(`(${candidate})`); return candidate; }
        catch (error) { if (!(error instanceof SyntaxError)) throw error; }
    }
    throw new Error(`Cannot extract ${name}`);
}

function tudouBase(config) {
    const scope = vm.createContext({});
    // 函数声明会直接绑定到 context 上；不能拿 runInContext 的返回值再赋回去（那是 undefined）。
    vm.runInContext(functionSource("isTudouSite"), scope);
    vm.runInContext(functionSource("localTudouRequestBase"), scope);
    return scope.localTudouRequestBase(config);
}

test("土豆请求基地址直接使用用户填的 baseUrl，不经过 Vercel 代理", () => {
    assert.equal(
        tudouBase({ provider: "tudou", baseUrl: "https://api.ai-tudou.net" }),
        "https://api.ai-tudou.net",
    );
    assert.equal(
        tudouBase({ provider: "tudou", baseUrl: "https://api.ai-tudou.net/v1" }),
        "https://api.ai-tudou.net/v1",
    );
});

test("打包文件里不再把土豆请求改写到 /api/tudou 或托管代理源", () => {
    // hostedProxyOrigin 会把 github.io 上的请求转发到 www.vinsen.top，已删除。
    assert.doesNotMatch(bundle, /function hostedProxyOrigin\(/);
    // localTudouRequestBase 里不能再出现代理路径拼接。
    const body = functionSource("localTudouRequestBase");
    assert.doesNotMatch(body, /\/api\/tudou/);
    assert.match(body, /return e\.baseUrl\}/);
});

test("Gemini 流式直连：参考图在浏览器侧内联后只发一次 POST", () => {
    // 代理原来负责把 Cloudinary 参考图下载成 inlineData，现在由前端自己做。
    assert.match(bundle, /inlineTudouGeminiReferences\(new URL\(tudouUrl\),\s*t,\s*\{signal:n,redirect:"follow"\}\)/);
    // 内联后再体一次请求；fetch 调用仍然只有一个。
    const start = bundle.indexOf("async function tudouGeminiStreamImages");
    const body = bundle.slice(start, bundle.indexOf("async function qMe", start));
    assert.equal((body.match(/fetch\(/g) || []).length, 1);
    assert.match(body, /const tudouUrl=isTudouNano21Model\(e\.model\)\?Jq\(e,"generateContent"\)/);
});

test("内联器同时支持 Node 与浏览器（Vercel 代理仍可回退使用）", () => {
    // Buffer 分支给 Node（代理/本地预览），btoa 分支给浏览器直连。
    assert.match(inliner, /typeof Buffer !== "undefined"/);
    assert.match(inliner, /btoa\(binary\)/);
    // 浏览器里 fetch 脱离 window 调用会抛 Illegal invocation，必须包一层。
    assert.match(inliner, /\(\.\.\.args\) => fetch\(\.\.\.args\)/);
    // 浏览器直连需要跟随重定向（Node 端保留 manual 以便校验跳转主机）。
    assert.match(inliner, /options\.redirect/);
});

test("其它 4 个站点不受直连改动影响", () => {
    // xA 是唯一拼土豆地址的入口，且只在 isTudouSite 为真时被使用。
    const body = functionSource("xA");
    assert.match(body, /localTudouRequestBase\(e\)/);
    for (const scope of ["grsai", "apimart", "runninghub", "soon"]) {
        assert.ok(
            bundle.includes(`provider==="${scope}"`) || bundle.includes(`is${scope[0].toUpperCase()}${scope.slice(1)}Site`),
            `missing ${scope} detection`,
        );
    }
    // 土豆的结果图与其它站点各自的代理路径保持原样。
    assert.match(bundle, /TUDOU_BASE_URL="https:\/\/api\.ai-tudou\.net"/);
});
