import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import * as mart from '../apimart-api.js';
import * as rh from '../runninghub-api.js';
import * as grsai from '../grsai-api.js';
import * as soon from '../soon-api.js';
import { orderModelReferences, orderRatioPresets } from '../display-order.js';

const source = await readFile(new URL('../assets/index-B2KJ37fm.js', import.meta.url), 'utf8');
const model = 'apimart::nano-banana-2.1';
const newSites = ['grsai', 'tudou'];
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
    for (let end = source.indexOf(']', start); end !== -1; end = source.indexOf(']', end + 1)) {
        const candidate = source.slice(start, end + 1);
        try { new vm.Script(`(${candidate})`); return candidate; }
        catch (error) { if (!(error instanceof SyntaxError)) throw error; }
    }
    throw new Error(`Cannot extract ${name}`);
}
function runtime(extra = {}) {
    const constants = Object.fromEntries(['APOLLO_SITE_MODELS', 'APOLLO_IMAGE_MODELS', 'APOLLO_TEXT_MODELS',
        'TUDOU_SITE_MODELS', 'TUDOU_IMAGE_MODELS', 'TUDOU_TEXT_MODELS'].map(name => [name, vm.runInNewContext(arraySource(name))]));
    const scope = vm.createContext({ ...constants, ...mart, ...rh, ...grsai, ...soon,
        cn: () => 'generated-id', th: error => error.message, $Me: prompt => prompt,
        assertApolloNanoBilling() {},
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
        'imageNodeConfig', 'bd', 'll', 'activeSiteApiKey', 'xxe', 'cPe', 'vke', 'Q0', 'X0', 'NX', 'RX', 'isApolloGptImageModel', 'jMe', 'isNanoRatioModel', 'nanoRatioPresets',
        'uy', 'Q6', 'displayImageModelName', 'runningHubUiParams', 'defaultImageModelParams', 'normalizeImageModelParams',
        'imageModelParamsFromConfig', 'projectImageModelParams', 'migrateImageGenerationDefaults', 'updateImageGenerationDefaults', 'applyImageGenerationDefaults',
        'canonicalImageModel', 'imageGenerationDefaultsKey', 'imageGenerationDefaultsFor', 'imageNodeDraftPatch', 'switchImageNodeSite',
        'isTudouSite', 'isTudouNano21Model', 'isTudouNanoImageConfig', 'tudouBackendModel', 'tudouAspectRatios', 'tudouAspectRatio', 'DL', 'P0',
        'n4e', 'ZM', 'Qa', 'Hke', 'vLocalAsset', 'CX', 'Ey']) vm.runInContext(functionSource(name), scope);
    for (const name of ['NANO_PRO_RATIO_PRESETS', 'NANO_21_RATIO_PRESETS']) scope[name] = vm.runInContext(arraySource(name), scope);
    for (const [, name] of source.matchAll(/(TUDOU_[A-Z0-9_]*ASPECT_RATIOS)=\[/g)) scope[name] = vm.runInContext(arraySource(name), scope);
    scope.channels = scope.wxe('', []).map(site => ({ ...site, apiKey: `${site.id}-test-key` }));
    scope.an = config(scope);
    return scope;
}
function config(scope, siteId = 'apimart') {
    const site = scope.channels.find(site => site.id === siteId);
    const selected = `${siteId}::${['apimart', 'grsai', 'tudou'].includes(siteId) ? 'nano-banana-2.1' : 'nano-banana-pro'}`;
    return { ...site, channels: scope.channels, activeSiteId: siteId, channelMode: 'local', model: selected, imageModel: selected,
        models: site.models.map(model => `${siteId}::${model}`), imageModels: scope.siteModelRefs(siteId, scope.siteImageModelNames(siteId)),
        textModel: 'default::gemini-3.8-flash', quality: '2k', size: '16:9', count: '1',
        imageModelDefaults: { [model]: { quality: '2k', size: '16:9' }, 'apimart::nano-banana-pro': { quality: '4k', size: '1:1' } } };
}

test('catalog migration keeps credentials and exposes 2.1 only at supported sites', () => {
    const scope = runtime();
    const old = scope.channels.map(site => ({ ...site, models: ['nano-banana-pro'] }));
    for (const site of scope.wxe('', old)) {
        const supported = ['apimart', ...newSites].includes(site.id);
        assert.equal(site.apiKey, `${site.id}-test-key`);
        assert.equal(site.models.includes('nano-banana-2.1'), supported);
        assert.equal(scope.siteImageModelNames(site.id).includes('nano-banana-2.1'), supported);
        assert.equal(scope.siteTextModelNames(site.id).includes('nano-banana-2.1'), false);
    }
});

test('real channel selection and RX preserve 2.1 and all existing Pro aliases', () => {
    const scope = runtime();
    for (const site of newSites) {
        for (const selected of ['nano-banana-2.1', 'nano-banana-pro', 'nano-banana-pro-2k', 'nano-banana-pro-4k']) {
            const ref = `${site}::${selected}`;
            const request = scope.RX(scope.ll(config(scope, 'apimart'), ref));
            assert.equal(request.provider, site);
            assert.equal(request.apiKey, `${site}-test-key`);
            assert.equal(request.baseUrl, scope.channels.find(channel => channel.id === site).baseUrl);
            assert.equal(request.model, selected === 'nano-banana-2.1' ? selected : 'nano-banana-pro');
            assert.equal(scope.jMe(ref), selected !== 'nano-banana-2.1');
            assert.equal(scope.isNanoRatioModel(ref), true);
        }
    }
});

test('real DL and P0 route each new 2.1 model once with its own key and references', async () => {
    for (const site of newSites) {
        const calls = [], uploads = [];
        const signal = new AbortController().signal;
        const onProgress = () => {};
        const record = (provider, request, prompt, references, options) => {
            calls.push({ provider, request, prompt, references, options });
            return Promise.resolve(['https://images.example/result.png']);
        };
        const scope = runtime({
            runGrsaiImageGeneration: (...args) => record('grsai', ...args),
            dW: async (request, prompt, references, count, options) => {
                assert.equal(count, 1);
                await record('tudou', request, prompt, references, options);
                return [{ id: 'tudou-result', dataUrl: 'https://images.example/result.png' }];
            },
            submitTudouGptImages: () => assert.fail('2.1 must use Tudou Gemini, never GPT'),
            imgbbReferenceSource: async (request, reference, uploadSignal, progress) => {
                uploads.push({ provider: request.provider, reference, signal: uploadSignal, progress });
                return `https://res.cloudinary.com/test/image/upload/${reference.name}.png`;
            },
            soonReferenceSource: async (request, reference, uploadSignal, progress) => {
                uploads.push({ provider: request.provider, reference, signal: uploadSignal, progress });
                return `https://files.example/${reference.name}.png`;
            },
            withTudouReferenceAspectRatio: async request => request,
        });
        // Deliberately leave the active site on Mart: the selected reference must determine routing.
        const input = { ...config(scope, 'apimart'), model: `${site}::nano-banana-2.1`, imageModel: `${site}::nano-banana-2.1` };
        const references = [{ name: 'first', dataUrl: 'blob:first' }, { name: 'second', dataUrl: 'blob:second' }];
        for (const result of [await scope.DL(input, 'draw', { signal, onProgress }),
            await scope.P0(input, 'edit', references, undefined, { signal, onProgress })]) {
            assert.equal(result[0].dataUrl, 'https://images.example/result.png');
        }
        assert.equal(calls.length, 2);
        for (const call of calls) {
            assert.equal(call.provider, site);
            assert.equal(call.request.provider, site);
            assert.equal(call.request.apiKey, `${site}-test-key`);
            assert.equal(call.request.model, site === 'tudou' ? 'gemini-nano-banana-2.1' : 'nano-banana-2.1');
            assert.equal(call.options.signal, signal);
            assert.equal(call.options.onProgress, onProgress);
        }
        assert.deepEqual(Array.from(calls[0].references), []);
        assert.deepEqual(Array.from(calls[1].references), references.map(reference =>
            `https://res.cloudinary.com/test/image/upload/${reference.name}.png`));
        assert.equal(uploads.length, references.length);
        for (const upload of uploads) {
            assert.equal(upload.provider, site);
            assert.equal(upload.signal, signal);
            assert.equal(upload.progress, onProgress);
        }
        assert.equal(references[0].dataUrl, 'blob:first');
        calls.length = 0;
        await assert.rejects(scope.P0(input, 'edit', references, { mask: true }, { signal }), /蒙版|\\u8499/);
        assert.equal(calls.length, 0, 'unsupported masks must fail before a generation request');
    }
});

test('2.1 ratio menus include four extra ratios without changing Pro or unsupported sites', () => {
    const scope = runtime();
    const extras = ['1:4', '4:1', '1:8', '8:1'];
    for (const site of ['apimart', ...newSites]) {
        const ref = `${site}::nano-banana-2.1`;
        const options = Array.from(scope.nanoRatioPresets(ref), option => option.value);
        assert.equal(options.length, 15);
        for (const ratio of extras) {
            assert.equal(options.includes(ratio), true);
            const request = scope.RX(scope.ll(config(scope, site), ref));
            request.size = ratio;
            assert.equal(scope.normalizeImageModelParams(request).size, ratio);
            if (site === 'apimart') assert.equal(mart.apiMartImageRequestSpec(request, 'draw').body.size, ratio);
            if (site === 'grsai') assert.equal(grsai.grsaiImageRequestSpec(request, 'draw').body.aspectRatio, ratio);
            if (site === 'tudou') assert.equal(scope.tudouAspectRatio(request), ratio);
        }
        const pro = Array.from(scope.nanoRatioPresets(`${site}::nano-banana-pro`), option => option.value);
        assert.equal(pro.length, 11);
        for (const ratio of extras) assert.equal(pro.includes(ratio), false);
    }
    for (const site of ['default', 'runninghub', 'soon']) {
        assert.equal(scope.siteImageModelNames(site).includes('nano-banana-2.1'), false);
        const options = Array.from(scope.nanoRatioPresets(`${site}::nano-banana-pro`), option => option.value);
        for (const ratio of extras) assert.equal(options.includes(ratio), false);
    }
});

test('new 2.1 model defaults persist separately from Pro and every other site', () => {
    const scope = runtime();
    let current = scope.migrateImageGenerationDefaults(config(scope));
    const expected = { grsai: ['1k', '1:4'], tudou: ['2k', '4:1'] };
    for (const site of newSites) {
        const ref = `${site}::nano-banana-2.1`;
        current = { ...current, ...scope.buildSiteConfigPatch(current, site),
            ...scope.applyImageGenerationDefaults(current, ref, site, true) };
        current = { ...current, ...scope.updateImageGenerationDefaults(current, {
            quality: expected[site][0], size: expected[site][1],
        }) };
        current = { ...current, ...scope.applyImageGenerationDefaults(current, `${site}::nano-banana-pro`) };
        current = { ...current, ...scope.updateImageGenerationDefaults(current, { quality: '4k', size: '21:9' }) };
    }
    current = plain(current); // Browser storage round trip.
    for (const site of newSites) {
        const nano = scope.imageGenerationDefaultsFor(current, site, `${site}::nano-banana-2.1`);
        const pro = scope.imageGenerationDefaultsFor(current, site, `${site}::nano-banana-pro`);
        assert.deepEqual([nano.quality, nano.size], expected[site]);
        assert.deepEqual([pro.quality, pro.size], ['4k', '21:9']);
        current = { ...current, ...scope.buildSiteConfigPatch(current, site) };
        current = { ...current, ...scope.applyImageGenerationDefaults(current, `${site}::nano-banana-2.1`) };
        assert.equal(current.imageModel, `${site}::nano-banana-2.1`);
        assert.deepEqual([current.quality, current.size], expected[site]);
    }
    assert.equal(scope.imageGenerationDefaultsFor(current, 'apimart', model).size, '16:9');
    for (const site of ['default', 'runninghub', 'soon']) {
        const patch = scope.buildSiteConfigPatch({ ...current, model, imageModel: model }, site);
        assert.equal(patch.imageModel, `${site}::nano-banana-pro`);
        assert.equal(patch.imageModels.includes(`${site}::nano-banana-2.1`), false);
    }
});

test('site switches preserve generated history while the next request uses a separate draft', () => {
    const scope = runtime();
    for (const site of newSites) {
        const ref = `${site}::nano-banana-2.1`;
        const node = { id: 'image', type: 'image', metadata: { model: ref, content: 'blob:generated', quality: '2k', size: '16:9' } };
        for (const target of ['apimart', ...newSites, 'default', 'runninghub', 'soon'].filter(target => target !== site)) {
            const switched = scope.switchImageNodeSite(node, config(scope, target));
            const nextModel = `${target}::${['default', 'runninghub', 'soon'].includes(target) ? 'nano-banana-pro' : 'nano-banana-2.1'}`;
            assert.equal(switched.metadata.model, ref);
            assert.equal(switched.metadata.imageGenerationDraft.model, nextModel);
            const next = scope.Q0(config(scope, target), switched, 'image');
            assert.equal(next.model, nextModel);
            const routed = scope.RX(scope.ll(next, next.model));
            assert.equal(routed.provider, target === 'default' ? 'apilio' : target);
            assert.equal(routed.apiKey, `${target}-test-key`);
            assert.equal(node.metadata.imageGenerationDraft, undefined);
        }
    }
});

test('project save and reopen retain each new site 2.1 history and retry routing', async () => {
    for (const site of newSites) {
        const model = `${site}::nano-banana-2.1`;
        const files = new Map();
        const image = new Blob(['nano image bytes'], { type: 'image/png' });
        const folder = { async getFileHandle(path) { return {
            async createWritable() { return { async write(value) { files.set(path, value); }, async close() {} }; },
            async getFile() { return files.get(path); },
        }; } };
        const savedNode = { id: 'image', type: 'image', width: 640, height: 360, metadata: {
            model, quality: '2k', size: { grsai: '1:4', tudou: '4:1' }[site], count: 1, generationType: 'generation', content: 'blob:old',
            generatedAt: '2026-10-08T06:00:00Z', naturalWidth: 640, naturalHeight: 360,
            imageGenerationDraft: { model: `${site}::nano-banana-pro`, quality: '4k' },
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
        assert.doesNotMatch(json, /apiKey|(?:apimart|grsai|tudou|soon)-test-key/);
        const project = JSON.parse(json);
        const reopened = await callback('Ep', ',sv=c.useCallback')(project);
        for (const key of ['model', 'quality', 'size', 'count']) assert.equal(reopened[0].metadata[key], savedNode.metadata[key]);
        assert.equal(reopened[0].metadata.imageGenerationDraft, undefined);
        const resolved = scope.Q0(config(scope, 'apimart'), reopened[0], 'image');
        const request = scope.RX(scope.ll(resolved, resolved.model));
        assert.equal(request.model, 'nano-banana-2.1');
        assert.equal(request.provider, site);
        assert.equal(request.apiKey, `${site}-test-key`);
        if (site === 'tudou') assert.equal(scope.tudouBackendModel(request.model, request), 'gemini-nano-banana-2.1');
        else if (site === 'grsai') assert.equal(grsai.grsaiImageRequestSpec(request, 'retry').body.model, 'nano-banana-2.1');
        assert.equal(savedNode.metadata.model, model);
    }
});
