// 土豆 is called straight from the browser with the site key: no relay, no COS,
// so the picture comes back as fast as the user's own line to 土豆 allows.
// The browser asks here to be charged before it sends a generation, and to be
// refunded when 土豆 fails. The key is visible to signed-in users; the admin
// accepted that for a handful of users (swap the key on the admin page if it leaks).

import { randomBytes } from "node:crypto";
import { background, checkLowBalances } from "./alerts.js";
import { describeRequest } from "./describe.js";
import { CHANNEL_LABELS } from "./mask.js";
import { channelConfig } from "./channels.js";
import { ADMIN_ONLY_MODELS, channelForUrl, findPrice } from "./relay.js";
import { AccountError, adjustBalance, milliToYuan } from "./service.js";

export const DIRECT_CHANNELS = new Set(["tudou"]);
const REFUND_WINDOW_MS = 2 * 60 * 60 * 1000;

export async function chargeDirect(db, user, input) {
    const { target, channel } = channelForUrl(input?.url);
    if (!DIRECT_CHANNELS.has(channel)) throw new AccountError(400, "not_direct", "这个渠道不能直连");
    const { model, spec, count } = describeRequest(target, input?.body && typeof input.body === "object" ? input.body : null);
    if (user.role === "admin") return { ref: "", amount: 0 };
    const config = await channelConfig(db, channel);
    if (!config.enabled || !config.apiKey) throw new AccountError(503, "channel_off", "这个渠道暂时不可用，请换一个渠道");
    if (ADMIN_ONLY_MODELS.has(model)) throw new AccountError(403, "admin_only", "官方模式仅管理员可用，请切换到固定模式");
    const unit = model ? await findPrice(db, channel, model, spec) : null;
    if (unit == null) {
        const label = [CHANNEL_LABELS[channel] || channel, model || "?", spec].filter(Boolean).join(" / ");
        throw new AccountError(402, "not_priced", `这个模型还没开放余额生成（${label}），请联系管理员定价`);
    }
    const amount = unit * count;
    const ref = `direct:${randomBytes(6).toString("hex")}`;
    const note = `${channel} ${model}${spec ? ` ${spec}` : ""}${count > 1 ? ` ×${count}` : ""}`;
    if (amount > 0) {
        const balance = await adjustBalance(db, user.id, -amount, { kind: "usage", note, ref });
        if (balance === null) throw new AccountError(402, "insufficient", "余额不足，请先兑换充值");
        background(checkLowBalances(db, { ids: [channel] }));
    }
    return { ref, amount: milliToYuan(amount) };
}

// Gives back one direct charge of this user, once, within two hours.
export async function refundDirect(db, user, input) {
    const ref = String(input?.ref || "");
    if (!/^direct:[a-f0-9]{12}$/.test(ref)) throw new AccountError(400, "bad_ref", "退款凭证不正确");
    const rows = await db.query(
        "SELECT kind, delta_milli, note, created_at FROM lw_ledger WHERE user_id = $1 AND ref = $2",
        [user.id, ref],
    );
    const charge = rows.find((r) => r.kind === "usage");
    if (!charge) throw new AccountError(404, "no_charge", "没有找到这次扣费");
    if (Date.now() - new Date(charge.created_at).getTime() > REFUND_WINDOW_MS) {
        throw new AccountError(400, "too_late", "超过退款时间");
    }
    // Claim the refund atomically: parallel calls with the same ref get only one row back.
    const claimed = await db.query(
        "INSERT INTO lw_direct_refunds (ref, user_id) VALUES ($1, $2) ON CONFLICT (ref) DO NOTHING RETURNING ref",
        [ref, user.id],
    );
    if (!claimed.length) return { refunded: 0 };
    const amount = -Number(charge.delta_milli);
    const reason = String(input?.reason || "生成失败").replace(/\s+/g, " ").slice(0, 60);
    await adjustBalance(db, user.id, amount, { kind: "refund", note: `${charge.note}（${reason}）`, ref });
    return { refunded: milliToYuan(amount) };
}
