// Emails the admins when a supplier balance drops below its alert line.
// Checked after generations (throttled per site) and once a day by cron;
// one email per low site per 12 hours, reset once the balance recovers.

import { channelBalances } from "./channels.js";
import { sendAdminMail } from "./mailer.js";
import { adminNames } from "./service.js";

export const ALERT_SCHEMA = `
ALTER TABLE lw_channels ADD COLUMN IF NOT EXISTS alert_sent_at TIMESTAMPTZ;
`;

const REPEAT_MS = 12 * 60 * 60 * 1000;

export async function checkLowBalances(db, { ids = null, minIntervalMs = 10 * 60 * 1000, fetchImpl = fetch, send = sendAdminMail } = {}) {
    const rows = await db.query("SELECT id, last_checked_at, alert_sent_at FROM lw_channels");
    const byId = new Map(rows.map((r) => [r.id, r]));
    const now = Date.now();
    const wanted = ids || ["tudou", "apimart", "grsai", "runninghub", "soon"];
    const due = wanted.filter((id) => {
        const last = byId.get(id)?.last_checked_at;
        return !last || now - new Date(last).getTime() >= minIntervalMs;
    });
    if (!due.length) return { checked: [], alerted: [] };

    const { items } = await channelBalances(db, { ids: due, fetchImpl });
    const alerted = [];
    for (const item of items) {
        if (item.status === "low") {
            const sent = byId.get(item.id)?.alert_sent_at;
            if (!sent || now - new Date(sent).getTime() >= REPEAT_MS) alerted.push(item);
        } else if (item.status === "ok") {
            await db.query("UPDATE lw_channels SET alert_sent_at = NULL WHERE id = $1 AND alert_sent_at IS NOT NULL", [item.id]);
        }
    }
    if (alerted.length) {
        const lines = alerted.map((b) => `${b.name}：剩 ${b.unit}${Number(b.balance).toFixed(2)}（提醒线 ${b.unit}${b.alertThreshold}）${b.topupUrl ? ` 充值：${b.topupUrl}` : ""}`);
        const subject = `老屋作坊：${alerted.map((b) => b.name).join("、")} 余额不足，该充值了`;
        const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Microsoft YaHei',sans-serif;max-width:520px;color:#1f2937">
  <h2 style="font-size:18px;margin:0 0 12px">上游站点余额不足</h2>
  ${alerted.map((b) => `<p style="margin:0 0 10px"><b>${b.name}</b>：剩 ${b.unit}${Number(b.balance).toFixed(2)}，低于提醒线 ${b.unit}${b.alertThreshold}${b.topupUrl ? `　<a href="${b.topupUrl}">去充值</a>` : ""}</p>`).join("")}
  <p style="color:#64748b;font-size:13px;margin-top:16px">余额恢复到提醒线以上之前，每个站点最多 12 小时提醒一次。</p>
</div>`;
        await send(adminNames(), { subject, text: lines.join("\n"), html });
        for (const b of alerted) await db.query("UPDATE lw_channels SET alert_sent_at = now() WHERE id = $1", [b.id]);
    }
    return { checked: due, alerted: alerted.map((b) => b.id) };
}

// Runs work after the response on Vercel (waitUntil), fire-and-forget elsewhere.
let vercelFunctions;
export function background(promise) {
    const safe = Promise.resolve(promise).catch((error) => console.error("Background task failed:", error));
    vercelFunctions ??= import("@vercel/functions").catch(() => null);
    vercelFunctions.then((mod) => { try { mod?.waitUntil?.(safe); } catch { /* not on Vercel */ } });
    return safe;
}
