import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import tudouProxy from '../api/tudou-proxy.js';
import { inlineTudouGeminiReferences, isTudouGeminiImageTarget } from '../tudou-reference-images.js';

const source = await readFile(new URL('../assets/index-B2KJ37fm.js', import.meta.url), 'utf8');
const localServer = await readFile(new URL('../local-preview-server.mjs', import.meta.url), 'utf8');
const backend = 'gemini-nano-banana-2.1';
const endpoint = `https://api.ai-tudou.net/v1beta/models/${backend}:generateContent`;
const baseRatios = ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'];
const newRatios = [...baseRatios, '1:4', '4:1', '1:8', '8:1'];
const plain = value => JSON.parse(JSON.stringify(value));
const imageJson = { candidates: [{ content: { parts: [
    { thought: true, inlineData: { mimeType: 'image/png', data: 'ignored' } },
    { inlineData: { mimeType: 'image/png', data: 'AQID' } },
] } }] };
function functionSource(name) {
    let start = source.indexOf(`function ${name}(`);
    assert.notEqual(start, -1, name);
    if (source.slice(start - 6, start) === 'async ') start -= 6;
    for (let end = source.indexOf('}', start); end !== -1; end = source.indexOf('}', end + 1)) {
        const candidate = source.slice(start, end + 1);
        try { new vm.Script(`(${candidate})`); return candidate; }
        catch (error) { if (!(error instanceof SyntaxError)) throw error; }
    }
    throw new Error(`Cannot extract ${name}`);
}
function runtime(extra = {}) {
    const scope = vm.createContext({ VR: '::', TextDecoder,
        cn: () => 'image-id',
        Tm: value => Boolean(value) && typeof value === 'object' && !Array.isArray(value),
        aW: async response => (await response.json()).error.message,
        ...extra,
    });
    for (const name of ['TUDOU_NANO_ASPECT_RATIOS', 'TUDOU_NANO21_ASPECT_RATIOS', 'TUDOU_GPT_ASPECT_RATIOS']) {
        const start = source.indexOf(`${name}=[`) + name.length + 1;
        assert.ok(start > name.length, name);
        scope[name] = vm.runInContext(source.slice(start, source.indexOf(']', start) + 1), scope);
    }
    for (const name of ['$S', 'pr', 'jMe', 'isTudouNano21Model',
        'isTudouNanoImageConfig', 'tudouAspectRatios', 'tudouAspectRatio', 'tudouResolution',
        'tudouBackendModel', 'tudouGeminiGenerationConfig', 'isTudouSite', 'wA', 'eW',
        'localTudouRequestBase', 'DMe', 'zMe', 'Jq', 'oW', 'tudouStreamRequestId',
        'appendTudouGeminiSseEvent', 'geminiResponseLayers', 'geminiNoImageMessage', 'WMe',
        'tudouGeminiStreamImages']) vm.runInContext(functionSource(name), scope);
    return scope;
}
function config(model = 'tudou::nano-banana-2.1') {
    return { provider: 'tudou', baseUrl: 'https://api.ai-tudou.net', apiKey: 'test-key', model, quality: '2k', size: '16:9' };
}

test('Tudou 2.1 UI and backend select Gemini independently from Pro and Mart Ext', () => {
    const scope = runtime();
    for (const model of ['nano-banana-2.1', 'tudou::nano-banana-2.1', backend]) {
        assert.equal(scope.isTudouNano21Model(model), true);
        assert.equal(scope.jMe(model), false);
        assert.equal(scope.tudouBackendModel(model, config(model)), backend);
        assert.equal(scope.isTudouNanoImageConfig({ model }), true);
        assert.equal(scope.isTudouNanoImageConfig({ imageModel: model }), true);
    }
    assert.equal(scope.tudouBackendModel('tudou::nano-banana-pro'), 'gemini-3-pro-image-preview');
    assert.equal(scope.tudouBackendModel('tudou::gpt-image-2'), 'gpt-image-2-all');
    assert.equal(scope.isTudouNano21Model('gemini-nano-banana-2.1-ext'), false);
});

test('2.1 passes selected resolutions and requested extended ratios into Gemini imageConfig', () => {
    const scope = runtime();
    for (const model of ['tudou::nano-banana-2.1', backend]) {
        assert.deepEqual(new Set(scope.tudouAspectRatios({ model })), new Set(newRatios));
        for (const size of newRatios) {
            for (const [quality, imageSize] of [['auto', '1K'], ['1k', '1K'], ['2k', '2K'], ['4k', '4K']]) {
                assert.deepEqual(plain(scope.tudouGeminiGenerationConfig({ model, size, quality })), {
                    responseModalities: ['TEXT', 'IMAGE'], imageConfig: { aspectRatio: size, imageSize },
                });
            }
        }
    }
    assert.deepEqual(plain(scope.tudouGeminiGenerationConfig({ model: backend, size: 'auto' })), {
        responseModalities: ['TEXT', 'IMAGE'], imageConfig: { imageSize: '1K' },
    });
    assert.deepEqual(new Set(scope.tudouAspectRatios({ model: 'nano-banana-pro' })), new Set(baseRatios));
    assert.equal(scope.tudouAspectRatio({ model: 'nano-banana-pro', size: '1:8' }), undefined);
});

test('2.1 sends one synchronous POST and accepts direct JSON or proxy SSE without replay', async () => {
    for (const proxied of [false, true]) {
        const requests = [];
        const signal = new AbortController().signal;
        const scope = runtime({ fetch: async (url, options) => {
            requests.push({ url, options });
            return proxied ? new Response(`: tudou-proxy\n\ndata: ${JSON.stringify(imageJson)}\n\n`, {
                headers: { 'Content-Type': 'text/event-stream' },
            }) : Response.json(imageJson);
        } });
        const input = config(backend);
        const payload = { contents: [{ role: 'user', parts: [{ text: 'draw' }] }], generationConfig: scope.tudouGeminiGenerationConfig(input) };
        assert.deepEqual(plain(await scope.tudouGeminiStreamImages(input, payload, signal)), [{ id: 'image-id', dataUrl: 'data:image/png;base64,AQID' }]);
        assert.equal(requests.length, 1);
        assert.equal(requests[0].url, endpoint);
        assert.equal(requests[0].options.method, 'POST');
        assert.equal(requests[0].options.signal, signal);
        assert.equal(requests[0].options.headers.Authorization, 'Bearer test-key');
        assert.deepEqual(JSON.parse(requests[0].options.body), plain(payload));
    }
});

test('Pro retains streamGenerateContent and 2.1 errors do not trigger a second request', async () => {
    let requests = 0;
    const scope = runtime({ fetch: async url => {
        requests++;
        assert.equal(url, 'https://api.ai-tudou.net/v1beta/models/gemini-3-pro-image-preview:streamGenerateContent?alt=sse');
        return Response.json(imageJson);
    } });
    await scope.tudouGeminiStreamImages(config('gemini-3-pro-image-preview'), { contents: [] });
    assert.equal(requests, 1);
    scope.fetch = async url => {
        requests++;
        assert.equal(url, endpoint);
        return Response.json({ error: { message: 'provider refused' } }, { status: 429 });
    };
    await assert.rejects(scope.tudouGeminiStreamImages(config(backend), { contents: [] }), /provider refused/);
    assert.equal(requests, 2);
    scope.fetch = async () => {
        requests++;
        return Response.json({ error: { message: 'upstream timeout after HTTP 200' } });
    };
    await assert.rejects(scope.tudouGeminiStreamImages(config(backend), { contents: [] }), /upstream timeout after HTTP 200/);
    assert.equal(requests, 3);
});

function referencePayload() {
    return { contents: [{ role: 'user', parts: [
        { fileData: { fileUri: 'https://res.cloudinary.com/test/image/upload/v1/reference.png' } },
        { text: 'keep the composition' },
    ] }], generationConfig: { responseModalities: ['TEXT', 'IMAGE'], imageConfig: { aspectRatio: '1:8', imageSize: '4K' } } };
}

test('hosted proxy inlines 2.1 references, preserves synchronous target, and wraps JSON into SSE', async () => {
    const previousFetch = globalThis.fetch;
    let requests = 0;
    globalThis.fetch = async (url, options) => {
        if (String(url).startsWith('https://res.cloudinary.com/')) return new Response(Uint8Array.from([1, 2, 3]), { headers: { 'Content-Type': 'image/png' } });
        requests++;
        assert.equal(String(url), endpoint);
        const forwarded = JSON.parse(options.body);
        assert.deepEqual(forwarded.contents[0].parts[0], { inlineData: { mimeType: 'image/png', data: 'AQID' } });
        assert.deepEqual(forwarded.generationConfig, referencePayload().generationConfig);
        assert.equal(options.headers.get('authorization'), 'Bearer test-key');
        return Response.json(imageJson);
    };
    try {
        const response = await tudouProxy.fetch(new Request(`https://www.vinsen.top/api/tudou-proxy?path=v1beta/models/${backend}:generateContent`, {
            method: 'POST', headers: { Authorization: 'Bearer test-key', 'Content-Type': 'application/json' }, body: JSON.stringify(referencePayload()),
        }));
        assert.equal(response.status, 200);
        assert.match(response.headers.get('content-type'), /text\/event-stream/);
        assert.match(await response.text(), new RegExp(`data: ${JSON.stringify(imageJson).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
        assert.equal(requests, 1);
    } finally { globalThis.fetch = previousFetch; }
});

test('local proxy recognizes 2.1 generateContent, inlines references, and returns one JSON SSE event', async () => {
    const start = localServer.indexOf('async function proxyTudouGeminiStream(');
    const end = localServer.indexOf('async function proxyTudouApi(', start);
    assert.ok(start >= 0 && end > start);
    assert.equal(isTudouGeminiImageTarget(endpoint), true);
    const writes = [];
    const intervals = new Map();
    let requests = 0;
    const fetchImpl = async (url, options) => {
        if (String(url).startsWith('https://res.cloudinary.com/')) return new Response(Uint8Array.from([1, 2, 3]), { headers: { 'Content-Type': 'image/png' } });
        requests++;
        assert.equal(String(url), endpoint);
        const payload = JSON.parse(options.body);
        assert.deepEqual(payload.contents[0].parts[0], { inlineData: { mimeType: 'image/png', data: 'AQID' } });
        assert.deepEqual(payload.generationConfig, referencePayload().generationConfig);
        return Response.json(imageJson);
    };
    const proxy = vm.runInNewContext(`${localServer.slice(start, end)};proxyTudouGeminiStream`, {
        Buffer, fetch: fetchImpl, setInterval: callback => { intervals.set(1, callback); return 1; }, clearInterval: id => intervals.delete(id),
        inlineTudouGeminiReferences: (target, payload, options) => inlineTudouGeminiReferences(target, payload, { ...options, fetchImpl }),
        console, errorDetails: error => error.message, sseData: value => `data: ${JSON.stringify(value)}\n\n`,
    });
    const response = { writableEnded: false, writeHead(status, headers) { assert.equal(status, 200); assert.match(headers['Content-Type'], /text\/event-stream/); },
        write: value => writes.push(Buffer.from(value)), end() { this.writableEnded = true; } };
    await proxy({}, response, new URL(endpoint), new Headers({ Authorization: 'Bearer test-key' }), referencePayload(), new AbortController());
    assert.ok(Buffer.concat(writes).toString().endsWith(`data: ${JSON.stringify(imageJson)}\n\n`));
    assert.equal(requests, 1);
    assert.equal(intervals.size, 0);
    assert.equal(response.writableEnded, true);
});
