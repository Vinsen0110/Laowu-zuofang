import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { APIMART_TEXT_MODELS } from "../apimart-api.js";
import tudouProxy from "../api/tudou-proxy.js";
import { usesCloudinaryReferenceHost } from "../cloudinary-reference-upload.js";

const bundle = await readFile(new URL("../assets/index-B2KJ37fm.js", import.meta.url), "utf8");

test("settings expose an independent global text site and model", () => {
    assert.match(bundle, /className:"generation-settings-sections"/);
    assert.match(bundle, /children:"生图模型设置"/);
    assert.match(bundle, /children:"文本模型设置"/);
    assert.match(bundle, /label:"\\u9ED8\\u8BA4\\u6587\\u672C\\u8BF7\\u6C42\\u7AD9\\u70B9"/);
    assert.match(bundle, /label:"\\u9ED8\\u8BA4\\u6587\\u672C\\u6A21\\u578B（\\u5168\\u5C40）"/);
    assert.match(
        bundle,
        /value:a\.textModel\|\|defaultTextModelRef\(a\.textSiteId\|\|DP\),capability:"text"/,
    );
    assert.match(bundle, /onChange:\$=>h\(\{textModel:\$\}\)/);
});

test("Tudou, RH, and Mart text generation use Chat Completions messages", async () => {
    const start = bundle.indexOf("function chatCompletionMessages");
    const end = bundle.indexOf("function SA", start);
    assert.ok(start >= 0 && end > start, "Chat Completions adapter should exist");

    const adapter = bundle.slice(start, end);
    const requests = [];
    const makeRequest = new Function(
        "fetch",
        "Gy",
        "xA",
        "isTudouSite",
        "isRunningHubSite",
        "RUNNINGHUB_LLM_ORIGIN",
        "wA",
        "aW",
        "AL",
        "prepareTextChatMessages",
        "assertTudouWebRequestSize",
        `${adapter};return requestChatCompletions;`,
    );
    const request = makeRequest(
        async (url, init) => {
            requests.push({ url, init });
            return new Response(JSON.stringify({
                choices: [{ message: { content: "反推结果" } }],
            }), { status: 200, headers: { "Content-Type": "application/json" } });
        },
        (baseUrl, path) => `${baseUrl.replace(/\/$/, "")}/v1${path}`,
        (_config, path) => `https://www.vinsen.top/api/tudou/v1${path}`,
        (config) => config.provider === "tudou",
        (config) => config.provider === "runninghub",
        "https://llm.runninghub.ai",
        () => ({ Authorization: "Bearer test-key", "Content-Type": "application/json" }),
        async () => "request failed",
        (payload) => {
            if (payload?.error?.message) throw new Error(payload.error.message);
        },
        async (messages) => messages,
        () => {},
    );

    const progress = [];
    const result = await request(
        { baseUrl: "https://custom.example", apiKey: "test-key", model: "gemini-3.8-flash" },
        [{
            role: "user",
            content: [
                { type: "text", text: "反推这张图" },
                { type: "image_url", image_url: { url: "data:image/png;base64,dGVzdA==" } },
            ],
        }],
        (value) => progress.push(value),
    );

    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, "https://custom.example/v1/chat/completions");
    const body = JSON.parse(requests[0].init.body);
    assert.equal(body.model, "gemini-3.8-flash");
    assert.deepEqual(body.messages, [{
        role: "user",
        content: [
            { type: "text", text: "反推这张图" },
            { type: "image_url", image_url: { url: "data:image/png;base64,dGVzdA==" } },
        ],
    }]);
    assert.equal(body.stream, false);
    assert.equal("input" in body, false);
    assert.equal(result.content, "反推结果");
    assert.deepEqual(progress, ["反推结果"]);

    await request(
        {
            provider: "tudou",
            baseUrl: "https://api.ai-tudou.net",
            apiKey: "test-key",
            model: "gpt-5.5",
        },
        [{ role: "user", content: "生成一段文字" }],
    );
    assert.equal(requests.length, 2);
    assert.equal(requests[1].url, "https://www.vinsen.top/api/tudou/v1/chat/completions");
    const tudouBody = JSON.parse(requests[1].init.body);
    assert.equal(tudouBody.model, "gpt-5.5");
    assert.deepEqual(tudouBody.messages, [{ role: "user", content: "生成一段文字" }]);
    assert.equal(tudouBody.stream, false);
    assert.equal(requests[1].init.headers.Accept, "application/json");

    await request(
        {
            provider: "runninghub",
            baseUrl: "https://www.runninghub.ai",
            apiKey: "test-key",
            model: "google/gemini-3.7-flash",
        },
        [{ role: "user", content: "生成一段文字" }],
    );
    assert.equal(requests.length, 3);
    assert.equal(requests[2].url, "https://llm.runninghub.ai/v1/chat/completions");
    const runningHubBody = JSON.parse(requests[2].init.body);
    assert.equal(runningHubBody.model, "google/gemini-3.7-flash");
    assert.deepEqual(runningHubBody.messages, [{ role: "user", content: "生成一段文字" }]);
    assert.equal(runningHubBody.stream, false);

    await request(
        {
            provider: "apimart",
            baseUrl: "https://api.apimart.ai",
            apiKey: "test-key",
            model: "gemini-3.8-flash",
        },
        [{ role: "user", content: "生成一段文字" }],
    );
    assert.equal(requests.length, 4);
    assert.equal(requests[3].url, "https://api.apimart.ai/v1/chat/completions");
    const apiMartBody = JSON.parse(requests[3].init.body);
    assert.equal(apiMartBody.model, "gemini-3.8-flash");
    assert.deepEqual(apiMartBody.messages, [{ role: "user", content: "生成一段文字" }]);
    assert.equal(apiMartBody.stream, false);
});

test("text routing has no Responses endpoint", () => {
    assert.match(bundle, /await requestChatCompletions\(o,tW\(o,t\),n,r\)/);
    assert.match(bundle, /o\.apiFormat==="gemini"&&!isTudouSite\(o\)/);
    assert.match(bundle, /isTudouSite\(e\)\?xA\(e,"\/chat\/completions"\):isRunningHubSite\(e\)\?Gy\(RUNNINGHUB_LLM_ORIGIN,"\/chat\/completions"\):Gy\(e\.baseUrl,"\/chat\/completions"\)/);
    assert.doesNotMatch(bundle, /if\(isRunningHubSite\(o\)\)throw new Error/);
    assert.doesNotMatch(bundle, /if\(isRunningHubSite\(i\)\)throw new Error/);
    assert.doesNotMatch(bundle, /xA\(e,"\/responses"\)/);
    assert.doesNotMatch(bundle, /fetch\([^)]*"\/responses"/);
});

test("oversized Tudou text requests no longer tell web users to switch apps", () => {
    assert.match(bundle, /assertTudouWebRequestSize=\(e,t\)=>/);
    // The size guard now points users at their image-host (Cloudinary) setup, not a specific provider key.
    assert.match(bundle, /\\u53c2\\u8003\\u56fe\\u5904\\u7406\\u540e\\u4ecd\\u8d85\\u8fc7\\u7f51\\u9875\\u8bf7\\u6c42\\u9650\\u5236.*\\u56fe\\u5e8a\\u4e0a\\u4f20\\u914d\\u7f6e/);
    assert.doesNotMatch(bundle, /ImgBB/);
});

test("Tudou proxy forwards Chat Completions unchanged", async () => {
    const originalFetch = globalThis.fetch;
    const forwarded = [];
    globalThis.fetch = async (url, init) => {
        forwarded.push({ url: String(url), init });
        return new Response(JSON.stringify({
            choices: [{ message: { content: "土豆返回" } }],
        }), { status: 200, headers: { "Content-Type": "application/json" } });
    };

    try {
        const request = new Request(
            "https://www.vinsen.top/api/tudou-proxy?path=v1/chat/completions",
            {
                method: "POST",
                headers: {
                    Authorization: "Bearer test-key",
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    model: "gpt-5.5",
                    messages: [{ role: "user", content: "测试" }],
                    stream: false,
                }),
            },
        );
        const response = await tudouProxy.fetch(request);
        assert.equal(response.status, 200);
        assert.equal(forwarded.length, 1);
        assert.equal(forwarded[0].url, "https://api.ai-tudou.net/v1/chat/completions");
        const body = JSON.parse(new TextDecoder().decode(forwarded[0].init.body));
        assert.deepEqual(body.messages, [{ role: "user", content: "测试" }]);
        assert.equal(body.stream, false);
        assert.equal(await response.json().then((value) => value.choices[0].message.content), "土豆返回");
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test("text requests use the global text route independently of the active image site", () => {
    assert.match(
        bundle,
        /model:n==="image"\|\|n==="text"\?ODe\(e,n,t\?\.metadata\?\.model\|\|r\)/,
    );
    assert.match(
        bundle,
        /function ODe\(e,t,n\)\{if\(t==="text"\)return textRequestConfig\(e\)\.textModel\|\|"";/,
    );
    assert.doesNotMatch(
        bundle,
        /function ODe\(e,t,n\)\{const r=CS\(e,t\)\|\|\[\],o=yx\(t==="text"\?/,
    );
});

test("recent canvas copies and external image pastes use source priority", () => {
    const start = bundle.indexOf("K.clipboardData?.files");
    const end = bundle.indexOf('window.addEventListener("paste",O)', start);
    assert.ok(start >= 0 && end > start, "native paste handler should exist");

    const handler = bundle.slice(start, end);
    assert.match(handler, /K\.clipboardData\?\.items/);
    assert.match(handler, /f\.current\.preferInternal/);
    assert.match(handler, /Date\.now\(\)-\(f\.current\.copiedAt\|\|0\)<3e4/);
    assert.match(handler, /Ea\(Ee,lastPointerWorldRef\.current\|\|Ji\(\)\)/);
    assert.match(handler, /if\(gt\)\{K\.preventDefault\(\),Cf\(\);return\}/);
    assert.match(bundle, /if\(le&&!K\.altKey&&Q==="v"\)\{return\}/);
    assert.match(bundle, /if\(le&&!K\.altKey&&Q==="c"\)\{Ih\(\)&&\(K\.preventDefault\(\),K\.stopPropagation\(\)\);return\}/);
    assert.doesNotMatch(bundle, /returnif/);
});

test("canvas copy reads the current selection and synchronizes click selection immediately", () => {
    assert.match(bundle, /Ih=c\.useCallback\(\(\)=>\{const O=oo\.current;/);
    assert.match(bundle, /lastPointerWorldRef=c\.useRef\(null\)/);
    assert.match(bundle, /lastPointerWorldRef\.current=or\(O\.clientX,O\.clientY\)/);
    assert.match(bundle, /const K=lastPointerWorldRef\.current\|\|Ji\(\)/);
    assert.match(bundle, /copiedAt:Date\.now\(\),preferInternal:!0/);
    assert.match(bundle, /document\.addEventListener\("visibilitychange",Q\)/);
    assert.match(bundle, /ye\(gt\),oo\.current=gt;/);
    assert.match(bundle, /function sanitizeCanvasNodeClone\(e\)\{const t=\{\.\.\.e,position:\{\.\.\.e\.position\},metadata:e\.metadata\?\{\.\.\.e\.metadata\}:void 0\}/);
});

test("canvas prompt edits update the immediate copy snapshot before generation", () => {
    assert.match(
        bundle,
        /\$f=c\.useCallback\(\(O,K\)=>\{const le=vn\.current\.map\(Ee=>Ee\.id===O\?\{\.\.\.Ee,metadata:\{\.\.\.Ee\.metadata,prompt:K\}\}:Ee\);vn\.current=le,_\(Q=>Q\.map\(Ee=>Ee\.id===O\?\{\.\.\.Ee,metadata:\{\.\.\.Ee\.metadata,prompt:K\}\}:Ee\)\)\},\[\]\)/,
    );
});

test("canvas content edits update the immediate copy snapshot before generation", () => {
    assert.match(
        bundle,
        /Sv=c\.useCallback\(\(O,K\)=>\{const le=vn\.current\.map\(Ee=>Ee\.id===O\?\{\.\.\.Ee,metadata:\{\.\.\.Ee\.metadata,content:K\}\}:Ee\);vn\.current=le,_\(Q=>Q\.map\(Ee=>Ee\.id===O\?\{\.\.\.Ee,metadata:\{\.\.\.Ee\.metadata,content:K\}\}:Ee\)\)\},\[\]\)/,
    );
});

test("Ctrl/Cmd+C inside an unselected canvas prompt copies the node, not browser text", () => {
    assert.match(
        bundle,
        /if\(le&&!K\.altKey&&Q==="c"&&editable\)\{const targetText=K\.target instanceof HTMLInputElement\|\|K\.target instanceof HTMLTextAreaElement\?K\.target:null,hasSelection=!!targetText&&typeof targetText\.selectionStart==="number"&&targetText\.selectionStart!==targetText\.selectionEnd/,
    );
    assert.match(
        bundle,
        /nodeElement=Ee\?\.closest\("\[data-node-id\]"\),nodeId=nodeElement\?\.getAttribute\("data-node-id"\);if\(!hasSelection&&nodeId\)\{oo\.current=new Set\(\[nodeId\]\);Ih\(\)&&\(K\.preventDefault\(\),K\.stopPropagation\(\)\)\}return\}/,
    );
});

test("editing a generated image prompt updates the copyable node metadata", () => {
    assert.match(
        bundle,
        /const N=z=>\{\$\(z\),\(v==="image"\|\|!C\)&&n\(e\.id,z\)\}/,
    );
});

test("Alt-click duplication suppresses the browser's native save action", () => {
    assert.match(bundle, /O\.altKey&&O\.preventDefault\(\)/);
    assert.match(bundle, /onClick:_e=>\{_e\.altKey&&\(_e\.preventDefault\(\),_e\.stopPropagation\(\)\)\}/);
});

test("Alt-click duplication refreshes the synchronous canvas copy snapshot", () => {
    const start = bundle.indexOf("Rn.length&&");
    const end = bundle.indexOf("oo.current=gt", start);
    assert.ok(start >= 0 && end > start);
    assert.match(bundle.slice(start, end), /Mt=\[\.\.\.le,\.\.\.Rn\]/);
    assert.match(bundle.slice(start, end), /vn\.current=Mt,ye\(gt\)/);
});

test("pasted canvas nodes refresh the synchronous copy snapshot", () => {
    const start = bundle.indexOf("Cf=c.useCallback");
    const end = bundle.indexOf("c.useCallback(()=>{ue", start);
    assert.ok(start >= 0 && end > start);
    assert.match(bundle.slice(start, end), /return _\(tt=>\{const le=\[\.\.\.tt,\.\.\.Mt\];return vn\.current=le,le\}\)/);
});
