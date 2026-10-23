// Pay-with-balance relay: /api/account/relay?t=<masked upstream URL>
//
// The browser sends a normal provider request whose API key is the placeholder
// "lw-balance". index.html reroutes it here. We look up the selling price,
// take it from the user's balance, call the provider with the site's own key,
// and refund automatically when the provider rejects the request.

import { randomBytes } from "node:crypto";

import { background, checkLowBalances } from "./alerts.js";
import { channelConfig } from "./channels.js";
import { describeRequest } from "./describe.js";
import { CHANNEL_LABELS, rewriteUrls, scrubText, unmaskTarget, verifyImageToken } from "./mask.js";
import { cosReady, getCos, moveInlineImagesToCos, parseGeminiAnswer } from "./cos.js";
import { AccountError, adjustBalance, milliToYuan } from "./service.js";
import { findTaskId, recordTask, settleTask, taskOutcome } from "./tasks.js";
import { inlineTudouGeminiReferences, isTudouGeminiImageTarget } from "../tudou-reference-images.js";

export { describeRequest };

export const BALANCE_KEY = "lw-balance";

// Upstream hosts the relay may call, and which channel's key they use.
const HOSTS = [
    [/^api\.ai-tudou\.net$/, "tudou"],
    [/^api\.apimart\.ai$/, "apimart"],
    [/^grsaiapi\.com$/, "grsai"],
    [/^(?:www|llm)\.runninghub\.ai$/, "runninghub"],
    [/^api(?:-[a-z]+)?\.soonstudio\.ai$/, "soon"],
];

// GPT Image 2.5 official (usage-billed) models are for admins only.
export const ADMIN_ONLY_MODELS = new Set(["gpt-image-2.5-flare", "gpt-image-2.5-sunburst", "rhart-image-g-2.5-official-token"]);

// Polling, uploads and result queries are free; only generation is charged.
const FREE_PATH = /\/upload|\/query$|\/result$|\/tasks(?:\/|$)/;

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

// Result and upload links reach users as /api/account/img?t=… (signed, sign-in
// only). When a user sends one back as a reference, the supplier must get its
// own original link, or its download is refused.
const PROXIED_IMAGE = /https?:\/\/[^"'\s\\]+\/api\/account\/img\?t=([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)/g;

export function restoreImageUrls(raw) {
    if (!raw) return raw;
    const text = new TextDecoder().decode(raw);
    if (!text.includes("/api/account/img?t=")) return raw;
    return new TextEncoder().encode(text.replace(PROXIED_IMAGE, (link, token) => verifyImageToken(token) || link));
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

function copyHeaders(upstream) {
    const headers = new Headers();
    for (const name of ["content-type", "cache-control"]) {
        const value = upstream.headers.get(name);
        if (value) headers.set(name, value);
    }
    headers.set("x-lw-relay", "1");
    return headers;
}

function passThrough(upstream) {
    return new Response(upstream.body, { status: upstream.status, headers: copyHeaders(upstream) });
}

// Users never see supplier names or URLs: errors are scrubbed and result URLs
// in small JSON bodies are pointed at the image proxy.
// x-lw-refund tells the page how much this request gave back, so it can say so.
function withRefund(headers, refundedMilli) {
    if (refundedMilli > 0) headers.set("x-lw-refund", String(milliToYuan(refundedMilli)));
    return headers;
}

export function userErrorMessage(status, message, refundedMilli) {
    const text = typeof message === "string" ? message : JSON.stringify(message);
    // Gateway timeouts and outages (502/503/504, Cloudflare 52x) carry long technical pages.
    const busy = status >= 500 && (status >= 520 || [502, 503, 504].includes(status) || /timeout|timed out|cloudflare|gateway/i.test(text));
    const base = busy ? `平台繁忙或超时（${status}），请稍后重试` : scrubText(text).slice(0, 500) || `生成失败（${status}）`;
    return refundedMilli > 0 ? `${base}。本次费用 ${milliToYuan(refundedMilli)} 已退回余额` : base;
}

async function forUser(upstream, request, onJson, refunded = () => 0) {
    const type = upstream.headers.get("content-type") || "";
    const length = Number(upstream.headers.get("content-length") || 0);
    if (upstream.status >= 400) {
        const text = await upstream.text().catch(() => "");
        let message = "";
        try {
            const data = JSON.parse(text);
            message = data?.error?.message || data?.message || data?.msg || data?.error || "";
        } catch { message = text; }
        const body = { error: { message: userErrorMessage(upstream.status, message, refunded()) } };
        const headers = withRefund(new Headers({ "Content-Type": "application/json; charset=utf-8", "x-lw-relay": "1" }), refunded());
        return new Response(JSON.stringify(body), { status: upstream.status, headers });
    }
    if (type.includes("json") && !type.includes("stream") && (!length || length < 2_000_000)) {
        const text = await upstream.text();
        let data;
        try { data = JSON.parse(text); } catch { return new Response(text, { status: upstream.status, headers: copyHeaders(upstream) }); }
        if (onJson) await onJson(data).catch((error) => console.error("Relay task tracking failed:", error));
        const origin = new URL(request.url).origin;
        return new Response(JSON.stringify(rewriteUrls(data, origin)), { status: upstream.status, headers: withRefund(copyHeaders(upstream), refunded()) });
    }
    return passThrough(upstream);
}

// A synchronous Gemini call can answer 200 without an image (e.g. blocked by
// safety). Watch the stream as it passes through and refund if no image came.
function refundIfNoImage(upstream, refund) {
    const decoder = new TextDecoder();
    let tail = "";
    let sawImage = false;
    const watch = new TransformStream({
        transform(chunk, controller) {
            if (!sawImage) {
                const text = tail + decoder.decode(chunk, { stream: true });
                if (/"inline_?[dD]ata"\s*:/.test(text)) sawImage = true;
                tail = text.slice(-32);
            }
            controller.enqueue(chunk);
        },
        async flush() {
            if (!sawImage) await refund("平台未返回图片");
        },
    });
    return new Response(upstream.body.pipeThrough(watch), { status: upstream.status, headers: copyHeaders(upstream) });
}

async function deliverGeminiViaCos(upstream, cos, signal) {
    const raw = await upstream.text();
    const sawInline = /"inline_?[dD]ata"\s*:/.test(raw);
    const payload = parseGeminiAnswer(raw);
    if (payload) {
        try {
            const moved = await moveInlineImagesToCos(cos, payload, { signal });
            if (moved > 0) {
                return {
                    sawImage: true,
                    response: new Response(JSON.stringify(payload), {
                        status: upstream.status,
                        headers: new Headers({ "Content-Type": "application/json; charset=utf-8", "x-lw-relay": "1", "x-lw-cos": String(moved) }),
                    }),
                };
            }
        } catch (error) {
            if (signal?.aborted) throw error;
            console.error("COS delivery failed, sending the image from this server:", error.message);
        }
    }
    // Not configured right or COS refused: send the answer as it came.
    return { sawImage: sawInline, response: new Response(raw, { status: upstream.status, headers: copyHeaders(upstream) }) };
}

export async function relay(db, user, request, { fetchImpl = fetch } = {}) {
    const url = new URL(request.url);
    const masked = url.searchParams.get("t");
    const { target, channel } = channelForUrl(masked ? unmaskTarget(masked) : url.searchParams.get("url"));
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
    let body = /json/.test(request.headers.get("content-type") || "") ? restoreImageUrls(raw) : raw;
    if (raw && channel === "tudou" && isTudouGeminiImageTarget(target)) {
        // Gemini wants references inline: fetch the hosted copies here, next to the
        // image host, so the browser uploads each reference only once.
        let parsed = null;
        try { parsed = JSON.parse(new TextDecoder().decode(body)); } catch { /* left to the checks below */ }
        if (parsed) {
            try {
                const { payload: inlined, converted } = await inlineTudouGeminiReferences(target, parsed, { signal: request.signal, redirect: "follow", fetchImpl });
                if (converted) body = new TextEncoder().encode(JSON.stringify(inlined));
            } catch (error) {
                if (request.signal?.aborted) throw error;
                throw new AccountError(502, "reference_failed", "参考图读取失败，请重试（未扣费）");
            }
        }
    }
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
        const isAdmin = user.role === "admin";
        if (!isAdmin && ADMIN_ONLY_MODELS.has(model)) {
            throw new AccountError(403, "admin_only", "官方模式仅管理员可用，请切换到固定模式");
        }
        // The owner's own generations are not charged.
        const unit = isAdmin ? 0 : model ? await findPrice(db, channel, model, spec) : null;
        if (unit == null) {
            const label = [CHANNEL_LABELS[channel] || channel, model || "?", spec].filter(Boolean).join(" / ");
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

    let refundedMilli = 0;
    const refund = async (reason) => {
        if (!charge) return;
        const c = charge;
        charge = null;
        refundedMilli += c.amount;
        await adjustBalance(db, user.id, c.amount, { kind: "refund", note: `${c.note}（${reason}）`, ref: c.ref })
            .catch((error) => console.error("Relay refund failed:", c.ref, error));
    };

    let upstream;
    try {
        upstream = await fetchImpl(target, {
            method,
            headers: forwardHeaders(request, config.apiKey),
            body,
            redirect: "manual",
            signal: request.signal,
        });
    } catch (error) {
        await refund("连接失败");
        throw new AccountError(502, "upstream_failed", "连接平台失败，费用已退回");
    }
    if (upstream.status >= 400) await refund(`平台返回 ${upstream.status}`);
    // 土豆 Nano Banana answers carry the picture inline (10–14 MB). With COS set up,
    // the original goes to the mainland bucket and the answer carries its link.
    if (upstream.status < 300 && upstream.body && /:generateContent$/.test(target.pathname)) {
        const cos = await getCos(db).catch(() => null);
        if (cosReady(cos)) {
            const delivered = await deliverGeminiViaCos(upstream, cos, request.signal);
            if (charge && !delivered.sawImage) await refund("平台未返回图片");
            if (charge) background(checkLowBalances(db, { ids: [channel] }));
            return delivered.response;
        }
    }
    if (charge && upstream.status < 300 && upstream.body && /:generateContent$/.test(target.pathname)) {
        return refundIfNoImage(upstream, refund);
    }
    // After a charged generation, check that site's balance (throttled) and email the admin if low.
    if (charge && upstream.status < 300) background(checkLowBalances(db, { ids: [channel] }));
    if (user.role === "admin") return passThrough(upstream);

    // Async tasks: remember charged submissions, settle them when a status check comes back.
    const isChat = /\/chat\/completions$/.test(target.pathname);
    const onJson = isChat ? null : async (data) => {
        if (charge) {
            const taskId = findTaskId(data);
            const failedNow = taskOutcome(data) === "failed" || (!taskId && (data?.error || (typeof data?.code === "number" && data.code !== 0 && data.code !== 200)));
            if (failedNow) {
                await refund("平台返回失败");
            } else if (taskId) {
                await recordTask(db, { channel, taskId, userId: user.id, ref: charge.ref, amount: charge.amount, note: charge.note });
            }
            return;
        }
        if (FREE_PATH.test(target.pathname)) {
            let taskId = findTaskId(data)
                || target.pathname.match(/\/tasks\/([^/]+)$/)?.[1]
                || target.searchParams.get("id")
                || "";
            if (!taskId && raw) {
                try { taskId = String(JSON.parse(new TextDecoder().decode(raw))?.taskId || ""); } catch { /* not JSON */ }
            }
            await settleTask(db, channel, decodeURIComponent(taskId), taskOutcome(data), (milli) => { refundedMilli += milli; });
        }
    };
    return forUser(upstream, request, onJson, () => refundedMilli);
}
