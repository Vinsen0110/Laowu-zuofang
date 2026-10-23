// Every model/spec the relay can charge for, with the upstream cost shown in
// the canvas price table. Each row's (channel, model, spec) is produced by the
// same request builders the canvas uses, then read back with describeRequest,
// so a price saved for a row always matches what the relay sees.

import { APIMART_ORIGIN, apiMartImagePrice, apiMartImageRequestSpec } from "../apimart-api.js";
import { GRSAI_ORIGIN, grsaiImagePrice, grsaiImageRequestSpec } from "../grsai-api.js";
import { RUNNINGHUB_ORIGIN, runningHubImagePrice, runningHubImageRequestSpec } from "../runninghub-api.js";
import { SOON_ORIGIN, soonImagePrice, soonImageRequestSpec } from "../soon-api.js";
import { ADMIN_ONLY_MODELS, describeRequest } from "./relay.js";

export const USD_TO_CNY = 6.7;
const RES = ["1k", "2k", "4k"];
const GPT_QUALITIES = ["low", "medium", "high"];
const TUDOU_GPT25_QUALITIES = ["low", "medium", "high", "xhigh", "max"];
const TUDOU_ORIGIN = "https://api.ai-tudou.net";

// Tudou's request builder and prices live in the app bundle; mirrored here (CNY).
const TUDOU_GPT25 = {
    flare: { low: [0.03, 0.03, 0.06], medium: [0.04, 0.04, 0.08], high: [0.05, 0.05, 0.1], xhigh: [0.06, 0.06, 0.12], max: [0.08, 0.12, 0.16] },
    sunburst: { low: [0.04, 0.04, 0.08], medium: [0.05, 0.05, 0.1], high: [0.07, 0.07, 0.12], xhigh: [0.1, 0.1, 0.15], max: [0.12, 0.12, 0.18] },
};

function row(channel, label, target, body, cost, currency) {
    const { model, spec } = describeRequest(new URL(target), body);
    const cny = cost == null ? null : Math.round(cost * (currency === "USD" ? USD_TO_CNY : 1) * 10000) / 10000;
    return { channel, label, model, spec, cost: cny, costText: cost == null ? "按量计费" : currency === "USD" ? `$${cost}` : `¥${cost}` };
}

function fromBuilder(channel, origin, build, price, currency, label, config) {
    const spec = build(config, "prompt", []);
    return row(channel, label, origin + spec.endpoint, spec.body, price(config), currency);
}

function tudouRows() {
    const rows = [];
    for (const [name, backend, prices] of [
        ["Nano Banana 2.1", "gemini-nano-banana-2.1", [0.088, 0.088, 0.11]],
        ["Nano Banana Pro", "gemini-3-pro-image-preview", [0.1, 0.1, 0.14]],
    ]) {
        RES.forEach((r, i) => rows.push(row("tudou", name, `${TUDOU_ORIGIN}/v1beta/models/${backend}:generateContent`,
            { generationConfig: { imageConfig: { imageSize: r.toUpperCase() } } }, prices[i], "CNY")));
    }
    for (const variant of ["flare", "sunburst"]) {
        for (const q of TUDOU_GPT25_QUALITIES) {
            RES.forEach((r, i) => rows.push(row("tudou", `GPT Image 2.5 · ${variant === "flare" ? "Flare" : "Sunburst"} · ${q}`,
                `${TUDOU_ORIGIN}/v1/images/generations/async`,
                { model: `gpt-image-2.5-${variant}-async`, resolution: r, quality: q }, TUDOU_GPT25[variant][q][i], "CNY")));
        }
    }
    return rows;
}

function apimartRows() {
    const rows = [];
    const add = (label, patch) => RES.forEach((quality) => rows.push(fromBuilder("apimart", `${APIMART_ORIGIN}/v1`, apiMartImageRequestSpec, apiMartImagePrice, "USD", label,
        { provider: "apimart", size: "1:1", quality, allowOfficial: true, ...patch })));
    add("Nano Banana 2.1", { model: "apimart::nano-banana-2.1" });
    add("Nano Banana Pro", { model: "apimart::nano-banana-pro" });
    add("GPT Image 2.5 · 固定", { model: "apimart::gpt-image-2.5", gptImageQuality: "fixed" });
    for (const variant of ["flare", "sunburst"]) {
        for (const q of GPT_QUALITIES) add(`GPT Image 2.5 · 官方 ${variant} · ${q}`, { model: "apimart::gpt-image-2.5", gptImageQuality: q, apimartGpt25Variant: variant });
    }
    return rows;
}

function runningHubRows() {
    const rows = [];
    const add = (label, patch) => RES.forEach((quality) => rows.push(fromBuilder("runninghub", RUNNINGHUB_ORIGIN, runningHubImageRequestSpec, runningHubImagePrice, "USD", label,
        { provider: "runninghub", size: "1:1", quality, allowOfficial: true, ...patch })));
    add("Nano Banana Pro", { model: "rh::nano-banana-pro" });
    add("GPT Image 2.5 · 固定", { model: "rh::gpt-image-2.5", runningHubGpt25Mode: "fixed" });
    for (const q of GPT_QUALITIES) add(`GPT Image 2.5 · 官方 · ${q}`, { model: "rh::gpt-image-2.5", runningHubGpt25Mode: "official", gptImageQuality: q });
    return rows;
}

function grsaiRows() {
    const rows = [];
    for (const [label, model] of [["Nano Banana 2.1", "nano-banana-2.1"], ["Nano Banana Pro", "nano-banana-pro"]]) {
        RES.forEach((quality) => rows.push(fromBuilder("grsai", GRSAI_ORIGIN, grsaiImageRequestSpec, grsaiImagePrice, "CNY", label,
            { provider: "grsai", size: "1:1", quality, model: `grsai::${model}` })));
    }
    return rows;
}

function soonRows() {
    return RES.map((quality) => fromBuilder("soon", SOON_ORIGIN, soonImageRequestSpec, soonImagePrice, "CNY", "Nano Banana Pro",
        { provider: "soon", size: "1:1", quality, model: "soon::nano-banana-pro" }));
}

// Text models (prompt helpers, chat) are charged per call; upstream cost depends on usage.
function textRows() {
    return [
        row("tudou", "文本 · Gemini 3.8 Flash", `${TUDOU_ORIGIN}/v1/chat/completions`, { model: "gemini-3.8-flash" }, null, "CNY"),
        row("apimart", "文本 · Gemini 3.8 Flash", `${APIMART_ORIGIN}/v1/chat/completions`, { model: "gemini-3.8-flash" }, null, "USD"),
        row("runninghub", "文本 · Gemini 3.8 Flash", "https://llm.runninghub.ai/v1/chat/completions", { model: "google/gemini-3.8-flash" }, null, "USD"),
    ];
}

let cached = null;
export function priceCatalog() {
    if (cached) return cached;
    const seen = new Set();
    // Admin-only models (GPT 2.5 official) are free for the admin and closed to users, so they are not priced.
    cached = [...tudouRows(), ...apimartRows(), ...runningHubRows(), ...grsaiRows(), ...soonRows(), ...textRows()].filter((r) => {
        if (ADMIN_ONLY_MODELS.has(r.model)) return false;
        const key = `${r.channel}|${r.model}|${r.spec}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
    return cached;
}
