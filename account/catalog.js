// Every model/spec the relay can charge for, with the upstream cost shown in
// the canvas price table. Each row's (channel, model, spec) is produced by the
// same request builders the canvas uses, then read back with describeRequest,
// so a price saved for a row always matches what the relay sees.

import { APIMART_ORIGIN, apiMartImagePrice, apiMartImageRequestSpec } from "../apimart-api.js";
import { GRSAI_ORIGIN, grsaiImagePrice, grsaiImageRequestSpec } from "../grsai-api.js";
import { RUNNINGHUB_ORIGIN, runningHubImagePrice, runningHubImageRequestSpec } from "../runninghub-api.js";
import { describeRequest, isAdminOnlyModel } from "./relay.js";

export const USD_TO_CNY = 6.7;
const RES = ["1k", "2k", "4k"];
const GPT_QUALITIES = ["low", "medium", "high"];
const TUDOU_ORIGIN = "https://api.ai-tudou.net";

// Tudou's request builder and prices live in the app bundle; mirrored here (CNY).
// GPT image 2.6 (Flare and Sunburst) is a flat ¥0.025 per image at 1K, 2K and 4K
// (OpenAI-style synchronous API since 2026-11-18; the -async models were retired).
const TUDOU_GPT26_PRICE = 0.025;

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
    // 土豆 2.6 costs the same for both variants, every resolution and quality, so it has one
    // catch-all price (spec ""), saved for Flare and, through `also`, for Sunburst. It is a
    // fixed per-image price, so it shares the "固定" row with Mart.
    rows.push({
        ...row("tudou", "GPT Image 2.6 · 固定", `${TUDOU_ORIGIN}/v1/images/generations`, { model: "gpt-image-2.6-flare" }, TUDOU_GPT26_PRICE, "CNY"),
        also: ["gpt-image-2.6-sunburst"],
    });
    return rows;
}

function apimartRows() {
    const rows = [];
    const add = (label, patch) => RES.forEach((quality) => rows.push(fromBuilder("apimart", `${APIMART_ORIGIN}/v1`, apiMartImageRequestSpec, apiMartImagePrice, "USD", label,
        { provider: "apimart", size: "1:1", quality, allowOfficial: true, ...patch })));
    add("Nano Banana 2.1", { model: "apimart::nano-banana-2.1" });
    add("Nano Banana Pro", { model: "apimart::nano-banana-pro" });
    add("GPT Image 2.6 · 固定", { model: "apimart::gpt-image-2.6", gptImageQuality: "fixed" });
    for (const variant of ["flare", "sunburst"]) {
        for (const q of GPT_QUALITIES) add(`GPT Image 2.6 · 官方 ${variant} · ${q}`, { model: "apimart::gpt-image-2.6", gptImageQuality: q, apimartGpt25Variant: variant });
    }
    return rows;
}

function runningHubRows() {
    const rows = [];
    const add = (label, patch) => RES.forEach((quality) => rows.push(fromBuilder("runninghub", RUNNINGHUB_ORIGIN, runningHubImageRequestSpec, runningHubImagePrice, "USD", label,
        { provider: "runninghub", size: "1:1", quality, allowOfficial: true, ...patch })));
    add("Nano Banana Pro", { model: "rh::nano-banana-pro" });
    return rows;
}

function grsaiRows() {
    const rows = [];
    for (const [label, model] of [["Nano Banana 2.1", "nano-banana-2.1"], ["Nano Banana Pro", "nano-banana-pro"]]) {
        RES.forEach((quality) => rows.push(fromBuilder("grsai", GRSAI_ORIGIN, grsaiImageRequestSpec, grsaiImagePrice, "CNY", label,
            { provider: "grsai", size: "1:1", quality, model: `grsai::${model}` })));
    }
    // GPT image 2.6 is sold per resolution; quality does not change the cost, so it is left out of the spec.
    for (const variant of ["flare", "sunburst"]) {
        RES.forEach((quality) => {
            const config = { provider: "grsai", model: "grsai::gpt-image-2.6", tudouGpt25Variant: variant, size: "1:1", quality };
            const { body } = grsaiImageRequestSpec(config, "prompt", []);
            rows.push(row("grsai", `GPT Image 2.6 · ${variant === "flare" ? "Flare" : "Sunburst"}`, `${GRSAI_ORIGIN}/v1/api/generate`,
                { model: body.model, aspectRatio: body.aspectRatio }, grsaiImagePrice(config), "CNY"));
        });
    }
    return rows;
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
    // Admin-only models (GPT official: Mart 2.6) are free for the admin and closed to users, so they are not priced.
    cached = [...tudouRows(), ...apimartRows(), ...runningHubRows(), ...grsaiRows(), ...textRows()].filter((r) => {
        if (isAdminOnlyModel(r.channel, r.model)) return false;
        const key = `${r.channel}|${r.model}|${r.spec}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
    return cached;
}

// A catalog row priced together with other models (`also`): saving its price saves the
// same price (or removal) for each of them, so the admin fills one cell.
export function withPriceAliases(items) {
    if (!Array.isArray(items)) return items;
    const catalog = priceCatalog();
    return items.flatMap((item) => {
        const spec = String(item?.spec ?? "").trim();
        const r = catalog.find((x) => x.also && x.channel === item?.channel && x.model === String(item?.model || "").trim() && x.spec === spec);
        return r ? [item, ...r.also.map((model) => ({ ...item, model }))] : [item];
    });
}
