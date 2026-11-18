import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import {
    isRunningHubSite,
    runningHubImagePrice,
    runningHubSupportedAspectRatios,
} from "../runninghub-api.js";
import {
    apiMartFixedQuality,
    apiMartGptBackground,
    apiMartGptImageQuality,
    apiMartGptOutputFormat,
    apiMartImageRequestSpec,
} from "../apimart-api.js";

// These tests cover the admin view, where Mart's GPT Image 2.6 "official" mode is available.
globalThis.__lwGptOfficial = true;

const source = await readFile(new URL("../assets/index-B2KJ37fm.js", import.meta.url), "utf8");

// Compile the shipped functions instead of recreating their rendering conditions.
function functionSource(name) {
    const start = source.indexOf(`function ${name}(`);
    assert.notEqual(start, -1, `${name} must exist in the shipped canvas bundle`);
    for (let end = source.indexOf("}", start); end !== -1; end = source.indexOf("}", end + 1)) {
        const candidate = source.slice(start, end + 1);
        try {
            new vm.Script(`(${candidate})`);
            return candidate;
        } catch (error) {
            if (!(error instanceof SyntaxError)) throw error;
        }
    }
    throw new Error(`Cannot extract ${name}`);
}

const plain = value => JSON.parse(JSON.stringify(value));
const jsx = (type, props, key) => ({ type, props: props || {}, key });
const site = provider => config => config?.provider === provider || config?.id === provider;
const context = vm.createContext({
    y: { jsx, jsxs: jsx, Fragment: "Fragment" },
    no: (...values) => values.filter(Boolean).join(" "),
    n$: "Select",
    uke: "ModelSelect",
    LocalImagePromptPresetSelect: "PresetSelect",
    Wwe: "ResolutionIcon",
    Ig: "SettingsIcon",
    VP: "RatioIcon",
    A0: "Label",
    GL: "ChoiceButton",
    Bt: "GenerateButton",
    Ky: "Spinner",
    vM: "PriceIcon",
    kP: "GenerateIcon",
    isRunningHubSite,
    isApiMartSite: site("apimart"),
    isTudouSite: site("tudou"),
    isGrsaiSite: site("grsai"),
    runningHubImagePrice,
    runningHubSupportedAspectRatios,
    apiMartFixedQuality,
    apiMartGptBackground,
    apiMartGptImageQuality,
    apiMartGptOutputFormat,
    tudouQuality: config => config.gptImageQuality || "medium",
    activeSiteApiKey: () => null,
    hX: [{ value: "auto" }, { value: "1k" }, { value: "2k" }, { value: "4k" }],
    orderRatioPresets: values => values,
    jMe: () => false,
    VR: "::",
    v5: value => value,
    DP: "fallback-site",
    an: {},
    Ne: { Image: "image", Config: "config" },
    activeSiteChannel: config => config.channels.find(channel => channel.id === config.activeSiteId),
    normalizeSiteApiKeys: channel => ({ apiKey: channel.apiKey }),
    ODe: (_config, _kind, model) => model,
    siteImageModelNames: () => ["nano-banana-pro", "gpt-image-2", "gpt-image-2.6"],
});

const qualityStart = source.indexOf("GPT_IMAGE_QUALITY_OPTIONS=[");
const optionsStart = source.indexOf("const APIMART_GPT_MODE_OPTIONS=");
const ratioStart = source.indexOf("pX=[");
const extraRatioStart = source.indexOf("GPT_IMAGE_EXTRA_RATIO_PRESETS=[");
const nanoRatioStart = source.indexOf("NANO_PRO_RATIO_PRESETS=[");
vm.runInContext(
    `const ${source.slice(qualityStart, source.indexOf(";", qualityStart) + 1)}
${source.slice(optionsStart, source.indexOf(";", optionsStart) + 1)}
const ${source.slice(ratioStart, source.indexOf("],ike=", ratioStart) + 1)};
const ${source.slice(nanoRatioStart, source.indexOf(",pg=", nanoRatioStart))};
const ${source.slice(extraRatioStart, source.indexOf(";", extraRatioStart) + 1)}`,
    context,
);
// Admin view: account-ui adds the official option for admins.
context.__lwGptModeOptions.push({ value: "official", label: "官方" });
for (const name of [
    "ES", "$S", "pr", "Nxe", "siteModelRefs", "yx", "imageNodeConfig", "switchImageNodeSite", "vX", "gke", "nanoRatioPresets", "isNanoRatioModel",
    "apiMartGptMode", "apiMartGpt25Variant", "apiMartOfficialQuality",
    "defaultImageModelParams", "canonicalImageModel", "normalizeImageModelParams",
    "imageModelParamsFromConfig", "projectImageModelParams", "imageGenerationDefaultsKey",
    "imageGenerationDefaultsFor", "updateImageGenerationDefaults", "applyImageGenerationDefaults",
    "cke", "gX", "vke", "Q0",
]) {
    vm.runInContext(functionSource(name), context);
}
context.bd = (config, model) => {
    const ref = context.$S(model);
    return config.channels.find(channel => channel.id === ref?.channelId)
        || config.channels.find(channel => channel.id === config.activeSiteId);
};

function nodes(tree) {
    if (tree == null || typeof tree !== "object") return [];
    if (Array.isArray(tree)) return tree.flatMap(nodes);
    const children = typeof tree.type === "function"
        ? tree.type(tree.props)
        : tree.props?.children;
    return [tree, ...nodes(children)];
}

function render(config) {
    const changes = [];
    const tree = context.cke({
        node: { id: "image-node" },
        config,
        canSubmit: true,
        credits: runningHubImagePrice(config),
        onConfigChange: (id, patch) => changes.push({ id, patch: plain(patch) }),
        onGenerate() {},
        onStop() {},
    });
    const all = nodes(tree);
    return {
        all,
        changes,
        selectors: all.filter(node => node.type === "Select"),
        button: all.find(node => node.type === "GenerateButton"),
        select(values) {
            return all.find(node => node.type === "Select"
                && JSON.stringify(node.props.items.map(item => item.value)) === JSON.stringify(values));
        },
    };
}

const rh = {
    provider: "runninghub",
    model: "runninghub::nano-banana-pro",
    quality: "2k",
    size: "16:9",
    gptImageQuality: "high",
};
const modes = ["fixed", "official"];
const variants = ["flare", "sunburst"];
const qualities = ["auto", "low", "medium", "high", "xhigh", "max"];
const formats = ["png", "jpeg", "webp"];

test("RH GPT Image 2 and Nano Banana Pro show no GPT mode, variant or official fields", () => {
    for (const model of ["gpt-image-2", "nano-banana-pro"]) {
        const view = render({ ...rh, model: `runninghub::${model}` });
        assert.equal(view.select(modes), undefined);
        assert.equal(view.select(variants), undefined);
        assert.equal(view.select(qualities), undefined);
        assert.equal(view.select(formats), undefined);
        const oldQuality = view.select(["low", "medium", "high"]);
        assert.equal(Boolean(oldQuality), model === "gpt-image-2");
    }
});

test("Mart variant callback stays on its independent setting and other sites have no variant control", () => {
    for (const provider of ["apimart"]) {
        const view = render({
            ...rh,
            provider,
            model: `${provider}::gpt-image-2.6`,
            apimartGpt25Variant: "flare",
        });
        view.select(variants).props.onChange("sunburst");
        assert.deepEqual(view.changes[0].patch, { apimartGpt25Variant: "sunburst" });
    }
    const other = render({ ...rh, provider: "custom", model: "custom::gpt-image-2.6", apimartGpt25Variant: "flare" });
    assert.equal(other.select(variants), undefined);
});

test("existing Mart GPT 2.6 panel, rendered mode controls and request route all switch together", () => {
    const channels = [
        { id: "default", provider: "custom", apiKey: "custom-test", models: ["gpt-image-2.6"] },
        { id: "apimart", provider: "apimart", apiKey: "mart-test", models: ["gpt-image-2.6"] },
    ];
    const original = {
        id: "existing", type: "image",
        metadata: { content: "blob:original", model: "apimart::gpt-image-2.6", quality: "2k", size: "1:1", gptImageQuality: "max" },
    };
    let node = original;
    for (const id of ["default", "apimart", "default"]) {
        const defaults = {
            ...channels.find(channel => channel.id === id), channels, activeSiteId: id,
            model: `${id}::gpt-image-2.6`, imageModel: `${id}::gpt-image-2.6`,
        };
        node = context.switchImageNodeSite(node, defaults);
        const panel = context.vke(defaults, node, "image");
        const request = context.Q0(defaults, node, "image");
        const view = render(panel);
        assert.equal(Boolean(view.select(modes)), id === "apimart");
        assert.equal(Boolean(view.select(formats)), id === "apimart");
        assert.equal(request.model, `${id}::gpt-image-2.6`);
        assert.equal(request.apiKey, defaults.apiKey);
        assert.equal(request.provider, defaults.provider);
        assert.equal(request.gptImageQuality, panel.gptImageQuality);
        if (id === "apimart") {
            const spec = apiMartImageRequestSpec(request, "test");
            assert.match(JSON.stringify(spec), /gpt-image-2\.6/);
        }
        assert.equal(node.metadata.model, original.metadata.model);
        assert.equal(node.metadata.gptImageQuality, "max");
    }
});

test("Mart GPT 2.6 and RH GPT2 keep the extended ratios", () => {
    for (const [provider, model] of [
        ["apimart", "gpt-image-2.6"],
        ["runninghub", "gpt-image-2"],
    ]) {
        const view = render({ ...rh, provider, model: `${provider}::${model}`, size: "2:1" });
        const ratios = view.selectors.find(node => node.props.showRatioShape);
        assert.equal(ratios.props.items.length, 16);
        assert.equal(ratios.props.value, "2:1");
    }
});
