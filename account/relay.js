// Pay-with-balance relay: /api/account/relay?url=<upstream URL>
//
// The browser sends a normal provider request whose API key is the placeholder
// "lw-balance". index.html reroutes it here. We look up the selling price,
// take it from the user's balance, call the provider with the site's own key,
// and refund automatically when the provider rejects the request.

import { randomBytes } from "node:crypto";

import { channelConfig } from "./channels.js";
import { AccountError, adjustBalance } from "./service.js";

export const BALANCE_KEY = "lw-balance";

// Upstream hosts the relay may call, and which channel's key they use.
const HOSTS = [
    [/^api\.ai-tudou\.net$/, "tudou"],
    [/^api\.apimart\.ai$/, "apimart"],
    [/^grsaiapi\.com$/, "grsai"],
    [/^(?:www|llm)\.runninghub\.ai$/, "runninghub"],
    [/^api(?:-[a-z]+)?\.soonstudio\.ai$/, "soon"],
];

// Polling, uploads and result queries are free; only generation is charged.
const FREE_PATH = /\/upload|\/query$|\/result$|\/tasks(?:\/|$)/;
const MAX_COUNT = 10;

export function channelForUrl(raw) {
    let target;
    try {
        target = new URL(String(raw || ""));
    } catch {
        throw new AccountError(400, "bad_target", "目标地址不正确");
    }
    if (target.protocol !== "https:") throw new AccountError(400, "bad_target", "目标地址不正确");
    const hit = HOSTS.find(([re]) => re.test(target.hostname));
    if (!hit) throw new AccountError(400, "bad_target", "这个平台不支持余额生成");
    return { target, channel: hit[1] };
}

// What the request is for: model, spec (resolution) and how many images.
export function describeRequest(target, payload) {
    const p = payload && typeof payload === "object" ? payload : {};
    const path = target.pathname;
    const model = String(
        p.model
        || path.match(/\/models\/([^/:]+)/)?.[1]
        || path.match(/\/openapi\/v2\/([^/]+)/)?.[1]
        || "",
    ).split("::").at(-1).trim();
    const resolution = String(
        p.resolution
        ?? p.imageSize
        ?? p.image_size
        ?? p.generationConfig?.imageConfig?.imageSize
        ?? "",
    ).trim().toLowerCase();
    // GPT image quality (low/medium/high…) changes the upstream cost, so it is part of the spec.
    const quality = typeof p.quality === "string" ? p.quality.trim().toLowerCase() : "";
    const spec = [resolution, quality].filter(Boolean).join("/");
    const n = Math.trunc(Number(p.n ?? p.num_images ?? 1));
    const count = Number.isFinite(n) && n > 0 ? Math.min(n, MAX_COUNT) : 1;
    return { model, spec, count };
}

// Most specific price wins: "2k/high", then "2k", then the model's catch-all "".
export async function findPrice(db, channel, model, spec) {
    const resolution = spec.split("/")[0];
    const rows = await db.query(
        `SELECT price_milli, spec FROM lw_prices
         WHERE channel = $1 AND model = $2 AND enabled AND spec IN ($3, $4, '')
         ORDER BY (spec = $3) DESC, (spec = $4) DESC LIMIT 1`,
        [channel, model, spec, resolution],
    );
    return rows[0] ? Number(rows[0].price_milli) : null;
}

function forwardHeaders(request, apiKey) {
    const headers = new Headers();
    for (const name of ["content-type", "accept"]) {
        const value = request.headers.get(name);
        if (value) headers.set(name, value);
    }
    headers.set("authorization", `Bearer ${apiKey}`);
    return headers;
}

function passThrough(upstream) {
    const headers = new Headers();
    for (const name of ["content-type", "cache-control"]) {
        const value = upstream.headers.get(name);
        if (value) headers.set(name, value);
    }
    headers.set("x-lw-relay", "1");
    return new Response(upstream.body, { status: upstream.status, headers });
}

export async function relay(db, user, request, { fetchImpl = fetch } = {}) {
    const url = new URL(request.url);
    const { target, channel } = channelForUrl(url.searchParams.get("url"));
    const method = request.method.toUpperCase();
    if (!["GET", "HEAD", "POST"].includes(method)) throw new AccountError(405, "bad_method", "不支持的请求方式");

    // Reads are only for task polling and results; account/balance endpoints stay private.
    if (method !== "POST" && !FREE_PATH.test(target.pathname)) {
        throw new AccountError(403, "forbidden_path", "这个接口不能通过余额调用");
    }

    const config = await channelConfig(db, channel);
    if (!config.enabled || !config.apiKey) {
        throw new AccountError(503, "channel_off", "这个平台暂时不能用余额生成，请联系管理员");
    }

    const raw = method === "POST" ? await request.arrayBuffer() : undefined;
    let charge = null;
    if (method === "POST" && !FREE_PATH.test(target.pathname)) {
        let payload = null;
        const type = request.headers.get("content-type") || "";
        if (type.includes("json")) {
            try {
                payload = JSON.parse(new TextDecoder().decode(raw));
            } catch {
                throw new AccountError(400, "bad_json", "请求格式不正确");
            }
        }
        const { model, spec, count } = describeRequest(target, payload);
        const unit = model ? await findPrice(db, channel, model, spec) : null;
        if (unit == null) {
            const label = [channel, model || "?", spec].filter(Boolean).join(" / ");
            throw new AccountError(402, "not_priced", `这个模型还没开放余额生成（${label}），请联系管理员定价`);
        }
        const amount = unit * count;
        const ref = `relay:${randomBytes(6).toString("hex")}`;
        const note = `${channel} ${model}${spec ? ` ${spec}` : ""}${count > 1 ? ` ×${count}` : ""}`;
        if (amount > 0) {
            const balance = await adjustBalance(db, user.id, -amount, { kind: "usage", note, ref });
            if (balance === null) throw new AccountError(402, "insufficient", "余额不足，请先兑换充值");
            charge = { amount, note, ref };
        }
    }

    const refund = async (reason) => {
        if (!charge) return;
        const c = charge;
        charge = null;
        await adjustBalance(db, user.id, c.amount, { kind: "refund", note: `${c.note}（${reason}）`, ref: c.ref })
            .catch((error) => console.error("Relay refund failed:", c.ref, error));
    };

    let upstream;
    try {
        upstream = await fetchImpl(target, {
            method,
            headers: forwardHeaders(request, config.apiKey),
            body: raw,
            redirect: "manual",
            signal: request.signal,
        });
    } catch (error) {
        await refund("连接失败");
        throw new AccountError(502, "upstream_failed", "连接平台失败，费用已退回");
    }
    if (upstream.status >= 400) await refund(`平台返回 ${upstream.status}`);
    return passThrough(upstream);
}
