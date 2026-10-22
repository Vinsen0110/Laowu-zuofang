// Settles generation tasks whose page went away before the result came back.
// The browser normally polls (and the relay settles on that poll); this runs
// from cron for the ones left pending: failed → refund, no answer for too
// long → refund as failed.

import { channelConfig } from "./channels.js";
import { settleTask, taskOutcome } from "./tasks.js";

const STATUS_REQUEST = {
    tudou: (id) => ({ url: `https://api.ai-tudou.net/v1/tasks/${encodeURIComponent(id)}` }),
    apimart: (id) => ({ url: `https://api.apimart.ai/v1/tasks/${encodeURIComponent(id)}?language=zh` }),
    grsai: (id) => ({ url: `https://grsaiapi.com/v1/api/result?id=${encodeURIComponent(id)}` }),
    runninghub: (id) => ({ url: "https://www.runninghub.ai/openapi/v2/query", method: "POST", body: JSON.stringify({ taskId: id }) }),
};

export async function sweepTasks(db, { fetchImpl = fetch, minAgeMs = 3 * 60_000, giveUpMs = 30 * 60_000, timeoutMs = 15_000 } = {}) {
    const rows = await db.query(
        `SELECT channel, task_id, EXTRACT(EPOCH FROM (now() - created_at)) * 1000 AS age_ms
         FROM lw_tasks WHERE status = 'pending' AND created_at < now() - make_interval(secs => $1)
         ORDER BY created_at LIMIT 200`,
        [minAgeMs / 1000],
    );
    const summary = { checked: 0, done: 0, refunded: 0, pending: 0 };
    const keys = new Map();
    for (const row of rows) {
        const build = STATUS_REQUEST[row.channel];
        let outcome = "pending";
        if (build) {
            if (!keys.has(row.channel)) keys.set(row.channel, (await channelConfig(db, row.channel)).apiKey);
            const apiKey = keys.get(row.channel);
            const { url, method = "GET", body } = build(row.task_id);
            try {
                const response = await fetchImpl(url, {
                    method, body,
                    headers: { Authorization: `Bearer ${apiKey}`, ...(body ? { "Content-Type": "application/json" } : {}) },
                    signal: AbortSignal.timeout(timeoutMs),
                });
                if (response.ok) outcome = taskOutcome(await response.json());
            } catch { /* try again next run */ }
        }
        if (outcome === "pending" && Number(row.age_ms) > giveUpMs) outcome = "failed";
        summary.checked += 1;
        const settled = await settleTask(db, row.channel, row.task_id, outcome);
        if (settled === "refunded") summary.refunded += 1;
        else if (settled === "done") summary.done += 1;
        else summary.pending += 1;
    }
    return summary;
}
