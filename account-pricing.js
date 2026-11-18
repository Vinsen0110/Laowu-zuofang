// Selling price shown in the canvas for signed-in users. It builds the same
// provider request the canvas sends and reads it with the relay's
// describeRequest, so the price shown is exactly what the relay charges.

import { APIMART_ORIGIN, apiMartImageRequestSpec } from "./apimart-api.js?v=20261117-mart26-01";
import { GRSAI_ORIGIN, grsaiImageRequestSpec } from "./grsai-api.js?v=20261117-grsai26-01";
import { RUNNINGHUB_ORIGIN, runningHubImageRequestSpec } from "./runninghub-api.js?v=20261118-clean25-01";
import { describeRequest } from "./account/describe.js?v=20261117-grsai26-01";

const TUDOU_ORIGIN = "https://api.ai-tudou.net";

const modelName = (value) => String(value || "").split("::").at(-1).trim();

// GPT image 2.6 on Tudou only supports 1K/2K and low/medium/high.
const isTudouGpt26 = (config) => modelName(config?.model || config?.imageModel).toLowerCase() === "gpt-image-2.6";

function tudouResolution(config) {
    const q = String(config?.quality || "").trim().toLowerCase();
    const resolution = q === "low" || q === "standard" ? "1k"
        : q === "medium" || q === "hd" ? "2k"
        : q === "high" ? "4k"
        : ["1k", "2k", "4k"].includes(q) ? q : "1k";
    return resolution === "4k" && isTudouGpt26(config) ? "2k" : resolution;
}

function tudouQuality(config) {
    const q = String(config?.gptImageQuality || "").trim().toLowerCase();
    if (isTudouGpt26(config)) return ["xhigh", "max"].includes(q) ? "high" : ["low", "medium", "high"].includes(q) ? q : "medium";
    return ["low", "medium", "high", "xhigh", "max"].includes(q) ? q : "medium";
}

// Mirrors the bundle's tudouBackendModel / request routing.
function tudouRequest(config) {
    const model = modelName(config?.model || config?.imageModel).toLowerCase();
    const resolution = tudouResolution(config);
    if (model === "nano-banana-2.1" || model === "gemini-nano-banana-2.1") {
        return { target: `${TUDOU_ORIGIN}/v1beta/models/gemini-nano-banana-2.1:generateContent`, body: { generationConfig: { imageConfig: { imageSize: resolution.toUpperCase() } } } };
    }
    if (model.startsWith("nano-banana-pro") || model === "gemini-3-pro-image-preview") {
        return { target: `${TUDOU_ORIGIN}/v1beta/models/gemini-3-pro-image-preview:generateContent`, body: { generationConfig: { imageConfig: { imageSize: resolution.toUpperCase() } } } };
    }
    if (model === "gpt-image-2.6") {
        const variant = String(config?.tudouGpt25Variant || "flare").trim().toLowerCase() === "sunburst" ? "sunburst" : "flare";
        return { target: `${TUDOU_ORIGIN}/v1/images/generations/async`, body: { model: `${model}-${variant}-async`, resolution, quality: tudouQuality(config) } };
    }
    if (model === "gpt-image-2" || model === "gpt-image-2-all") {
        return { target: `${TUDOU_ORIGIN}/v1/images/generations/async`, body: { model: "gpt-image-2-all", resolution, quality: tudouQuality(config) } };
    }
    return null;
}

function providerRequest(provider, config) {
    const withProvider = { ...config, provider };
    if (provider === "tudou") return tudouRequest(withProvider);
    const builders = {
        apimart: [`${APIMART_ORIGIN}/v1`, apiMartImageRequestSpec],
        runninghub: [RUNNINGHUB_ORIGIN, runningHubImageRequestSpec],
        grsai: [GRSAI_ORIGIN, grsaiImageRequestSpec],
    };
    const entry = builders[provider];
    if (!entry) return null;
    const spec = entry[1](withProvider, "price", []);
    return { target: entry[0] + spec.endpoint, body: spec.body };
}

// Price of one image in CNY, or null when the model/spec has no price yet.
export function lwSellPrice(config, site, prices = globalThis.__lwPrices) {
    if (!Array.isArray(prices)) return null;
    const provider = site?.provider || config?.provider;
    let request;
    try { request = providerRequest(provider, config); } catch { return null; }
    if (!request) return null;
    const { model, spec } = describeRequest(new URL(request.target), request.body);
    const resolution = spec.split("/")[0];
    const find = (s) => prices.find((p) => p.channel === provider && p.model === model && p.spec === s);
    const hit = find(spec) || find(resolution) || find("");
    return hit ? Number(hit.price) : null;
}
