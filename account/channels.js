// Upstream channels (the 5 platforms) and their balances, for the admin page.
// API keys live on the server only: in the database (set from the admin page)
// or in environment variables LW_KEY_<CHANNEL>, which take priority.

import { APIMART_IMAGE_MODELS, APIMART_TEXT_MODELS, fetchApiMartTokenBalance, fetchApiMartUserBalance } from "../apimart-api.js";
import { GRSAI_IMAGE_MODELS, fetchGrsaiAccountCredits, fetchGrsaiApiKeyCredits } from "../grsai-api.js";
import { RUNNINGHUB_IMAGE_MODELS, RUNNINGHUB_TEXT_MODELS, fetchRunningHubAccount } from "../runninghub-api.js";
import { SOON_IMAGE_MODELS } from "../soon-api.js";
import { AccountError, milliToYuan, yuanToMilli } from "./service.js";

const TUDOU_ORIGIN = "https://api.ai-tudou.net";

export const CHANNELS = [
    { id: "tudou", name: "土豆", unit: "$", topupUrl: "https://api.ai-tudou.net/wallet", models: ["nano-banana-2.1", "nano-banana-pro", "gpt-image-2.5", "gemini-3.8-flash"] },
    { id: "apimart", name: "APIMart", unit: "$", topupUrl: "https://apimart.ai/zh/billing", models: [...APIMART_IMAGE_MODELS, ...APIMART_TEXT_MODELS] },
    { id: "grsai", name: "Grsai", unit: "$", topupUrl: "https://grsai.com/zh/dashboard/billing", models: [...GRSAI_IMAGE_MODELS], extraKey: "账户 Token（查账户总余额用，可选）" },
    { id: "runninghub", name: "RunningHub", unit: "$", topupUrl: "https://www.runninghub.ai/vip-rights/4", models: [...RUNNINGHUB_IMAGE_MODELS, ...RUNNINGHUB_TEXT_MODELS] },
    { id: "soon", name: "Soon", unit: "$", topupUrl: "https://soonstudio.ai/account?tab=transactions&entry=main", models: [...SOON_IMAGE_MODELS] },
];

const CHANNEL_IDS = new Set(CHANNELS.map((c) => c.id));

export const CHANNEL_SCHEMA = `
CREATE TABLE IF NOT EXISTS lw_channels (
    id              TEXT PRIMARY KEY,
    api_key         TEXT NOT NULL DEFAULT '',
    base_url        TEXT NOT NULL DEFAULT '',
    alert_threshold NUMERIC NOT NULL DEFAULT 5,
    enabled         BOOLEAN NOT NULL DEFAULT TRUE,
    last_balance    NUMERIC,
    last_checked_at TIMESTAMPTZ,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE lw_channels ADD COLUMN IF NOT EXISTS api_key2 TEXT NOT NULL DEFAULT '';
CREATE TABLE IF NOT EXISTS lw_prices (
    id          BIGSERIAL PRIMARY KEY,
    channel     TEXT NOT NULL,
    model       TEXT NOT NULL,
    spec        TEXT NOT NULL DEFAULT '',
    price_milli BIGINT NOT NULL CHECK (price_milli >= 0),
    cost        TEXT NOT NULL DEFAULT '',
    note        TEXT NOT NULL DEFAULT '',
    enabled     BOOLEAN NOT NULL DEFAULT TRUE,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (channel, model, spec)
);
`;

function checkChannel(id) {
    if (!CHANNEL_IDS.has(id)) throw new AccountError(400, "bad_channel", "未知的渠道");
    return id;
}

function envKey(id) {
    return String(process.env[`LW_KEY_${id.toUpperCase()}`] || "").trim();
}

function maskKey(key) {
    if (!key) return "";
    return key.length <= 8 ? "••••" : `${key.slice(0, 4)}••••${key.slice(-4)}`;
}

async function channelRows(db) {
    const rows = await db.query("SELECT * FROM lw_channels");
    return new Map(rows.map((r) => [r.id, r]));
}

function resolve(def, row) {
    const fromEnv = envKey(def.id);
    return {
        apiKey: fromEnv || row?.api_key || "",
        apiKey2: row?.api_key2 || "",
        keySource: fromEnv ? "env" : row?.api_key ? "admin" : "",
        baseUrl: "", // provider URLs are built in
        alertThreshold: row ? Number(row.alert_threshold) : 5,
        enabled: row ? Boolean(row.enabled) : true,
    };
}

export async function listChannels(db) {
    const rows = await channelRows(db);
    return CHANNELS.map((def) => {
        const row = rows.get(def.id);
        const c = resolve(def, row);
        return {
            id: def.id,
            name: def.name,
            unit: def.unit,
            models: def.models,
            hasKey: Boolean(c.apiKey),
            keyPreview: maskKey(c.apiKey),
            keySource: c.keySource,
            extraKey: def.extraKey || "",
            topupUrl: def.topupUrl || "",
            hasKey2: Boolean(c.apiKey2),
            key2Preview: maskKey(c.apiKey2),
            baseUrl: c.baseUrl,
            alertThreshold: c.alertThreshold,
            enabled: c.enabled,
            lastBalance: row?.last_balance == null ? null : Number(row.last_balance),
            lastCheckedAt: row?.last_checked_at || null,
        };
    });
}

// Used by step 2 (server-side generation) to get the real key.
export async function channelConfig(db, id) {
    checkChannel(id);
    const rows = await channelRows(db);
    return resolve(CHANNELS.find((c) => c.id === id), rows.get(id));
}

export async function saveChannel(db, input) {
    const id = checkChannel(String(input?.id || ""));
    const threshold = Number(input?.alertThreshold);
    if (input?.alertThreshold !== undefined && !(Number.isFinite(threshold) && threshold >= 0)) {
        throw new AccountError(400, "bad_threshold", "提醒金额需为不小于 0 的数字");
    }
    const baseUrl = String(input?.baseUrl ?? "").trim();
    if (baseUrl && !/^https:\/\/[^\s]+$/i.test(baseUrl)) throw new AccountError(400, "bad_url", "接口地址需以 https:// 开头");
    // apiKey / apiKey2: undefined = keep, "" = clear, otherwise replace
    const key = input?.apiKey === undefined ? null : String(input.apiKey).trim();
    const key2 = input?.apiKey2 === undefined ? null : String(input.apiKey2).trim();
    await db.query(
        `INSERT INTO lw_channels (id, api_key, api_key2, base_url, alert_threshold, enabled)
         VALUES ($1, COALESCE($2, ''), COALESCE($3, ''), $4, COALESCE($5, 5), COALESCE($6, TRUE))
         ON CONFLICT (id) DO UPDATE SET
           api_key = COALESCE($2, lw_channels.api_key),
           api_key2 = COALESCE($3, lw_channels.api_key2),
           base_url = $4,
           alert_threshold = COALESCE($5, lw_channels.alert_threshold),
           enabled = COALESCE($6, lw_channels.enabled),
           updated_at = now()`,
        [id, key, key2, baseUrl, input?.alertThreshold === undefined ? null : threshold, input?.enabled === undefined ? null : Boolean(input.enabled)],
    );
    return (await listChannels(db)).find((c) => c.id === id);
}

function withTimeout(ms) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error("查询超时")), ms);
    return { signal: controller.signal, done: () => clearTimeout(timer) };
}

async function queryBalance(id, cfg, fetchImpl, signal) {
    const config = { apiKey: cfg.apiKey, baseUrl: cfg.baseUrl || undefined };
    if (id === "apimart") {
        try {
            const user = await fetchApiMartUserBalance(config, { fetchImpl, signal });
            return { balance: user, detail: "账户余额" };
        } catch (_) {
            const token = await fetchApiMartTokenBalance(config, { fetchImpl, signal });
            return { balance: token, detail: "令牌余额" };
        }
    }
    if (id === "grsai") {
        const credits = cfg.apiKey2
            ? await fetchGrsaiAccountCredits(config, cfg.apiKey2, { fetchImpl, signal })
            : await fetchGrsaiApiKeyCredits(config, { fetchImpl, signal });
        const value = credits / 1e4;
        return { balance: value < 1000 ? value : value / 5e5, detail: `${credits.toLocaleString()} 积分` };
    }
    if (id === "runninghub") {
        const data = await fetchRunningHubAccount(config, { fetchImpl, signal });
        const money = Number.parseFloat(String(data?.remainMoney ?? ""));
        if (!Number.isFinite(money)) throw new Error("RH 余额接口没有返回可用金额");
        return { balance: money, detail: "账户余额" };
    }
    if (id === "tudou") {
        const origin = String(cfg.baseUrl || TUDOU_ORIGIN).replace(/\/+$/, "").replace(/\/v1$/i, "").replace(/\/api$/i, "");
        const res = await fetchImpl(`${origin}/api/usage/token/`, {
            headers: { Accept: "application/json", Authorization: `Bearer ${cfg.apiKey}` },
            signal,
        });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(payload?.message || payload?.error?.message || `查询失败（HTTP ${res.status}）`);
        const data = payload?.data && typeof payload.data === "object" ? payload.data : payload;
        if (payload?.unlimited_quota === true || data?.unlimited_quota === true) return { balance: -1, detail: "无限额度" };
        const raw = Number(data?.total_available ?? data?.quota);
        if (!Number.isFinite(raw)) throw new Error("土豆余额接口没有返回可用额度");
        return { balance: raw / 5e5, detail: "令牌额度" };
    }
    throw new Error("这个渠道暂不支持自动查询余额");
}

export async function channelBalances(db, { fetchImpl = fetch, timeoutMs = 12000 } = {}) {
    const rows = await channelRows(db);
    const results = await Promise.all(CHANNELS.map(async (def) => {
        const row = rows.get(def.id);
        const cfg = resolve(def, row);
        const base = { id: def.id, name: def.name, unit: def.unit, alertThreshold: cfg.alertThreshold, enabled: cfg.enabled };
        if (!cfg.apiKey) return { ...base, status: "no_key", message: "还没有填写 API Key" };
        const t = withTimeout(timeoutMs);
        try {
            const { balance, detail } = await queryBalance(def.id, cfg, fetchImpl, t.signal);
            await db.query(
                `INSERT INTO lw_channels (id, last_balance, last_checked_at) VALUES ($1, $2, now())
                 ON CONFLICT (id) DO UPDATE SET last_balance = $2, last_checked_at = now()`,
                [def.id, balance],
            );
            const low = balance >= 0 && balance < cfg.alertThreshold;
            return { ...base, status: low ? "low" : "ok", balance, detail, message: low ? `余额低于 ${def.unit}${cfg.alertThreshold}，该充值了` : "" };
        } catch (error) {
            return { ...base, status: "error", message: error instanceof Error ? error.message : "查询失败" };
        } finally {
            t.done();
        }
    }));
    return { checkedAt: new Date().toISOString(), items: results };
}

// ---------- selling prices ----------
function publicPrice(r) {
    return {
        id: Number(r.id),
        channel: r.channel,
        model: r.model,
        spec: r.spec,
        price: milliToYuan(r.price_milli),
        cost: r.cost,
        note: r.note,
        enabled: Boolean(r.enabled),
        updatedAt: r.updated_at,
    };
}

export async function listPrices(db) {
    const rows = await db.query("SELECT * FROM lw_prices ORDER BY channel, model, spec");
    return rows.map(publicPrice);
}

export async function savePrice(db, input) {
    const channel = checkChannel(String(input?.channel || ""));
    const model = String(input?.model || "").trim().slice(0, 80);
    if (!model) throw new AccountError(400, "bad_model", "请填写模型名");
    const spec = String(input?.spec || "").trim().slice(0, 40);
    const price = yuanToMilli(input?.price);
    if (price < 0) throw new AccountError(400, "bad_price", "售价不能小于 0");
    const params = [channel, model, spec, price, String(input?.cost || "").slice(0, 40), String(input?.note || "").slice(0, 120), input?.enabled !== false];
    const rows = input?.id
        ? await db.query(
            `UPDATE lw_prices SET channel=$1, model=$2, spec=$3, price_milli=$4, cost=$5, note=$6, enabled=$7, updated_at=now()
             WHERE id=$8 RETURNING *`, [...params, Number(input.id)])
        : await db.query(
            `INSERT INTO lw_prices (channel, model, spec, price_milli, cost, note, enabled) VALUES ($1,$2,$3,$4,$5,$6,$7)
             ON CONFLICT (channel, model, spec) DO UPDATE SET price_milli=$4, cost=$5, note=$6, enabled=$7, updated_at=now()
             RETURNING *`, params);
    if (!rows[0]) throw new AccountError(404, "not_found", "这条价格不存在");
    return publicPrice(rows[0]);
}

export async function deletePrice(db, id) {
    await db.query("DELETE FROM lw_prices WHERE id = $1", [Number(id)]);
}

// Saves many catalog prices at once. An empty price removes that row.
export async function savePrices(db, items) {
    if (!Array.isArray(items) || items.length > 500) throw new AccountError(400, "bad_items", "价格数据不正确");
    for (const item of items) {
        const channel = checkChannel(String(item?.channel || ""));
        const model = String(item?.model || "").trim();
        const spec = String(item?.spec || "").trim();
        if (!model) continue;
        if (item.price === "" || item.price == null) {
            await db.query("DELETE FROM lw_prices WHERE channel = $1 AND model = $2 AND spec = $3", [channel, model, spec]);
        } else {
            await savePrice(db, { channel, model, spec, price: item.price, cost: item.cost, note: item.note });
        }
    }
    return listPrices(db);
}
