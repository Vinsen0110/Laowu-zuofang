import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import * as mart from '../apimart-api.js';
import * as rh from '../runninghub-api.js';
import * as grsai from '../grsai-api.js';
import { orderModelReferences, orderRatioPresets } from '../display-order.js';

const source = await readFile(new URL('../assets/index-B2KJ37fm.js', import.meta.url), 'utf8');
const model = 'apimart::nano-banana-2.1';
const plain = value => JSON.parse(JSON.stringify(value));
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
function arraySource(name) {
    const start = source.indexOf(`${name}=[`) + name.length + 1;
    assert.ok(start > name.length, name);
    const end = source.indexOf(']', start);
    return source.slice(start, end + 1);
}
function runtime(extra = {}) {
    const constants = Object.fromEntries(['APOLLO_SITE_MODELS', 'APOLLO_IMAGE_MODELS', 'APOLLO_TEXT_MODELS',
        'TUDOU_SITE_MODELS', 'TUDOU_IMAGE_MODELS', 'TUDOU_TEXT_MODELS'].map(name => [name, vm.runInNewContext(arraySource(name))]));
    const scope = vm.createContext({ ...constants, ...mart, ...rh, ...grsai,
        DP: 'default', VR: '::', a7: 'Apilio', cy: 'https://api.apilio.ai',
        TUDOU_SITE_ID: 'tudou', TUDOU_SITE_NAME: 'Tudou', TUDOU_BASE_URL: 'https://api.ai-tudou.net',
        zP: site => site, normalizeSiteApiKeys: site => ({ apiKey: site.apiKey, apiKeys: site.apiKeys || [] }),
        c: { useCallback: callback => callback }, Blob, Date,
        Ne: { Image: 'image', Text: 'text', Config: 'config', Video: 'video' }, Vr: { image: { width: 400, height: 400 } },
        bg: 'reverse prompt', IDe: state => state.imageModel, textRequestConfig: state => state,
        orderRatioPresets, ...extra,
    });
    for (const name of ['ES', '$S', 'pr', 'v5', 'yx', 'Nxe', 'siteModelRefs', 'siteImageModelNames', 'siteTextModelNames',
        'activeSiteChannel', 'textSiteChannel', 'normalizeTextConfig', 'buildSiteConfigPatch', 'wxe', 'CS', 'bxe', 'ODe',
        'imageNodeConfig', 'bd', 'xxe', 'cPe', 'vke', 'Q0', 'X0', 'NX', 'RX', 'isApolloGptImageModel', 'jMe', 'isNanoRatioModel',
        'uy', 'Q6', 'displayImageModelName', 'runningHubUiParams', 'defaultImageModelParams', 'normalizeImageModelParams',
        'imageModelParamsFromConfig', 'projectImageModelParams', 'migrateImageGenerationDefaults', 'updateImageGenerationDefaults', 'applyImageGenerationDefaults',
        'canonicalImageModel', 'imageGenerationDefaultsKey', 'imageGenerationDefaultsFor', 'imageNodeDraftPatch', 'switchImageNodeSite',
        'n4e', 'ZM', 'Qa', 'Hke', 'vLocalAsset', 'CX', 'Ey']) vm.runInContext(functionSource(name), scope);
    scope.channels = scope.wxe('', []).map(site => ({ ...site, apiKey: `${site.id}-test-key` }));
    scope.an = config(scope);
    return scope;
}
function config(scope, siteId = 'apimart') {
    const site = scope.channels.find(site => site.id === siteId);
    const selected = `${siteId}::${siteId === 'apimart' ? 'nano-banana-2.1' : 'nano-banana-pro'}`;
    return { ...site, channels: scope.channels, activeSiteId: siteId, channelMode: 'local', model: selected, imageModel: selected,
        models: site.models.map(model => `${siteId}::${model}`), imageModels: scope.siteModelRefs(siteId, scope.siteImageModelNames(siteId)),
        textModel: 'default::gemini-3.8-flash', quality: '2k', size: '16:9', count: '1',
        imageModelDefaults: { [model]: { quality: '2k', size: '16:9' }, 'apimart::nano-banana-pro': { quality: '4k', size: '1:1' } } };
}

test('catalog migration exposes Nano Banana 2.1 first in Mart and nowhere else', () => {
    const scope = runtime();
    const oldChannels = scope.channels.map(site => ({ ...site, models: site.models.filter(name => name !== 'nano-banana-2.1') }));
    const migrated = scope.wxe('', oldChannels);
    for (const site of migrated) {
        assert.equal(site.apiKey, `${site.id}-test-key`);
        const imageModels = Array.from(scope.siteImageModelNames(site.id));
        assert.equal(imageModels.includes('nano-banana-2.1'), site.id === 'apimart');
        assert.equal(site.models.includes('nano-banana-2.1'), site.id === 'apimart');
    }
    assert.deepEqual(Array.from(scope.siteImageModelNames('apimart')), ['nano-banana-2.1', 'nano-banana-pro', 'gpt-image-2.5']);
    const defaults = config(scope);
    for (const content of ['', 'blob:generated', '生成图/图片1.png']) {
        const node = { type: 'image', metadata: { model, content } };
        for (const name of ['vke', 'cPe', 'Q0']) {
            const resolved = scope[name](defaults, node, 'image');
            assert.equal(resolved.model, model);
            assert.deepEqual(Array.from(orderModelReferences(resolved.imageModels)), [model, 'apimart::nano-banana-pro', 'apimart::gpt-image-2.5']);
        }
    }
});

test('UI selection passes unchanged through RX to the Ext request without Pro rewriting', () => {
    const scope = runtime();
    const defaults = config(scope);
    const routed = scope.RX(scope.Q0(defaults, { type: 'image', metadata: { model, quality: '2k', size: '16:9' } }, 'image'));
    assert.equal(routed.model, model);
    assert.equal(routed.provider, 'apimart');
    assert.equal(routed.apiKey, 'apimart-test-key');
    assert.equal(scope.jMe(model), false, 'Pro-only routing must not include the new model');
    assert.equal(scope.isNanoRatioModel(model), true);
    assert.deepEqual(mart.apiMartImageRequestSpec(routed, 'draw').body, {
        model: 'gemini-nano-banana-2.1-ext', prompt: 'draw', size: '16:9', resolution: '2K', n: 1,
    });
    assert.equal(scope.Q6(defaults, model), 'Nano Banana 2.1');
    assert.equal(scope.displayImageModelName(model), 'Nano Banana 2.1');
    assert.equal(scope.Q6(defaults, 'apimart::nano-banana-pro'), 'Nano Banana Pro');
});

test('the real reference generation path enforces aggregate size on prepared upload copies', async () => {
    for (const lastPreparedSize of [10_000_000, 10_000_001]) {
        const originals = [30_000_000, 20_000_000, 15_000_000];
        const prepared = [20_000_000, 20_000_000, lastPreparedSize];
        const uploaded = [];
        const requests = [];
        const signal = new AbortController().signal;
        const onProgress = () => {};
        const scope = runtime({
            ll: value => value, $Me: prompt => prompt, assertApolloNanoBilling() {},
            th: error => error.message, cn: () => 'generated-id',
            fetch: async (url, options) => {
                assert.equal(options.signal, signal);
                return { ok: true, async blob() { return { size: originals[Number(url.slice(-1))] }; } };
            },
            uploadApiMartReferenceBlob: async (config, blob, options) => {
                const index = Number(options.filename.slice(-1));
                assert.equal(config.model, model);
                assert.equal(blob.size, originals[index]);
                assert.equal(options.signal, signal);
                assert.equal(options.onProgress, onProgress);
                options.onPrepared({ size: prepared[index] });
                uploaded.push(index);
                return `https://images.example/upload-${index}.png`;
            },
            runApiMartImageGeneration: async (config, prompt, references, options) => {
                requests.push({ config, prompt, references, options });
                return ['https://images.example/result.png'];
            },
        });
        for (const name of ['apiMartReferenceSource', 'P0']) vm.runInContext(functionSource(name), scope);
        const refs = originals.map((_, index) => ({ name: `reference-${index}`, dataUrl: `https://images.example/${index}` }));
        const generation = scope.P0(config(scope), 'draw', refs, undefined, { signal, onProgress });
        if (lastPreparedSize === 10_000_000) {
            const result = await generation;
            assert.equal(result[0].dataUrl, 'https://images.example/result.png');
            assert.equal(requests.length, 1, '50 MB prepared copies are accepted despite larger originals');
            assert.deepEqual(Array.from(requests[0].references), refs.map((_, index) => `https://images.example/upload-${index}.png`));
            assert.equal(requests[0].options.signal, signal);
            assert.equal(requests[0].options.onProgress, onProgress);
        } else {
            await assert.rejects(generation, /50\s*MB/);
            assert.equal(requests.length, 0, 'oversized aggregate must stop before submitting a paid generation');
        }
        assert.equal(originals[0], 30_000_000);
        assert.equal(uploaded.length, lastPreparedSize === 10_000_000 ? 3 : 2);
    }
});

test('the settings ratio selector offers only ratios accepted by the Nano 2.1 adapter', () => {
    const scope = runtime();
    for (const name of ['pg', 'GPT_IMAGE_EXTRA_RATIO_PRESETS', 'NANO_PRO_RATIO_PRESETS']) scope[name] = vm.runInContext(arraySource(name), scope);
    scope.e = config(scope);
    scope.isRunningHub25 = false;
    scope.isGptImageModel = scope.isApolloGptImageModel(model);
    scope.isNanoProModel = scope.isNanoRatioModel(model);
    const expression = source.match(/ratioPresets=(orderRatioPresets\([^;\n]*?\)),localPromptPreset=/)?.[1];
    assert.ok(expression, 'extract the real settings selector expression');
    const options = vm.runInContext(expression, scope);
    assert.deepEqual(Array.from(options, option => option.value), ['auto', '1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9']);
    for (const option of options) assert.doesNotThrow(() => mart.apiMartImageRequestSpec({ model, size: option.size || option.value }, 'draw'));
    for (const unsupported of ['2:1', '4:1', '1:4', '3:1', '9:21']) assert.equal(options.some(option => option.value === unsupported), false);
});

test('site switches and model defaults keep Nano 2.1 isolated from Pro and other providers', () => {
    const scope = runtime();
    let defaults = config(scope);
    const before = JSON.stringify(defaults);
    const params = scope.imageGenerationDefaultsFor(defaults, 'apimart', model);
    assert.equal(params.quality, '2k');
    assert.equal(params.size, '16:9');
    assert.equal(scope.imageGenerationDefaultsFor(defaults, 'apimart', 'apimart::nano-banana-pro').quality, '4k');
    for (const site of scope.channels.filter(site => site.id !== 'apimart')) {
        const patch = scope.buildSiteConfigPatch(defaults, site.id);
        assert.equal(patch.imageModel, `${site.id}::nano-banana-pro`);
        assert.equal(patch.imageModels.some(value => value.endsWith('::nano-banana-2.1')), false);
    }
    assert.equal(JSON.stringify(defaults), before);
    assert.equal(scope.buildSiteConfigPatch(defaults, 'apimart').imageModel, model);
    const generated = { id: 'image', type: 'image', metadata: { content: 'blob:generated', model, quality: '2k', size: '16:9' } };
    const switched = scope.switchImageNodeSite(generated, config(scope, 'tudou'));
    assert.equal(switched.metadata.model, model, 'history stays on Mart');
    assert.equal(switched.metadata.imageGenerationDraft.model, 'tudou::nano-banana-pro');
    assert.equal(generated.metadata.imageGenerationDraft, undefined);
});

test('changing models and leaving Mart restores separate persisted Nano 2.1 parameters', () => {
    const scope = runtime();
    let current = scope.migrateImageGenerationDefaults(config(scope));
    current = { ...current, ...scope.updateImageGenerationDefaults(current, { quality: '1k', size: '9:16' }) };
    const nanoDefaults = plain(current.imageModelDefaults[model]);
    current = { ...current, ...scope.applyImageGenerationDefaults(current, 'apimart::nano-banana-pro') };
    assert.equal(current.imageModel, 'apimart::nano-banana-pro');
    assert.equal(current.quality, '4k');
    assert.equal(current.size, '1:1');
    current = { ...current, ...scope.applyImageGenerationDefaults(current, model) };
    assert.equal(current.quality, '1k');
    assert.equal(current.size, '9:16');
    current = { ...current, ...scope.buildSiteConfigPatch(current, 'tudou'),
        ...scope.applyImageGenerationDefaults(current, 'tudou::nano-banana-pro', 'tudou', true) };
    assert.equal(current.imageModel, 'tudou::nano-banana-pro');
    assert.deepEqual(plain(current.imageModelDefaults[model]), nanoDefaults);
    current = { ...current, ...scope.buildSiteConfigPatch(current, 'apimart'),
        ...scope.applyImageGenerationDefaults(current, model, 'apimart', true) };
    assert.equal(current.imageModel, model);
    assert.equal(current.quality, '1k');
    assert.equal(current.size, '9:16');
});

test('project save and reopen retain the generated Nano 2.1 model and request parameters', async () => {
    const files = new Map();
    const image = new Blob(['nano image bytes'], { type: 'image/png' });
    const folder = { async getFileHandle(path) { return {
        async createWritable() { return { async write(value) { files.set(path, value); }, async close() {} }; },
        async getFile() { return files.get(path); },
    }; } };
    const savedNode = { id: 'image', type: 'image', width: 640, height: 360, metadata: {
        model, quality: '2k', size: '16:9', count: 1, generationType: 'generation', content: 'blob:old',
        generatedAt: '2026-10-08T06:00:00Z', naturalWidth: 640, naturalHeight: 360,
        imageGenerationDraft: { model: 'apimart::nano-banana-pro', quality: '4k' },
    } };
    const scope = runtime({
        Zo: { current: { root: folder, generatedAssets: folder, uploadedAssets: folder, nextGeneratedImageNumber: 1 } },
        vn: { current: [savedNode] }, Jr: { current: [] }, Ao: { current: { x: 1, y: 2, k: 1 } },
        Y: { title: 'Nano 2.1 round trip' }, Te: 'blank', It: false, ne: [], te: null,
        e: { success() {}, error(message) { throw new Error(message); } }, Sp: async () => image,
        mf: async (blob, kind, name) => { files.set(name, blob); return `${kind === 'generated' ? '生成图' : '上传图'}/${name}`; },
        storeCanvasImageWithoutDecode: async blob => ({ url: 'blob:reopened', storageKey: 'image:new', width: 640, height: 360, bytes: blob.size, mimeType: blob.type }),
    });
    function callback(name, end) {
        const start = source.indexOf(`${name}=c.useCallback`), finish = source.indexOf(end, start);
        assert.ok(start >= 0 && finish > start);
        return vm.runInContext(`(${source.slice(start + name.length + 1, finish)})`, scope);
    }
    scope.Cp = callback('Cp', ',zs=c.useCallback');
    assert.equal(await callback('zs', ',Th=c.useCallback')(false), true);
    const json = files.get('project.json');
    assert.doesNotMatch(json, /apiKey|apimart-test-key/);
    const project = JSON.parse(json);
    const reopened = await callback('Ep', ',sv=c.useCallback')(project);
    for (const key of ['model', 'quality', 'size', 'count']) assert.equal(reopened[0].metadata[key], savedNode.metadata[key]);
    assert.equal(reopened[0].metadata.imageGenerationDraft, undefined);
    const request = scope.RX(scope.Q0(config(scope, 'tudou'), reopened[0], 'image'));
    assert.equal(request.model, model);
    assert.equal(request.provider, 'apimart');
    assert.equal(mart.apiMartImageRequestSpec(request, 'retry').body.model, 'gemini-nano-banana-2.1-ext');
    assert.equal(savedNode.metadata.model, model);
});
