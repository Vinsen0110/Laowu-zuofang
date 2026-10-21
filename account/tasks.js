// Async generation tasks (GPT on Tudou, Mart, Grsai, RH). The charge happens
// at submit; when a later status check reports failure — or success without an
// image — the charge is refunded automatically, exactly once.

import { adjustBalance } from "./service.js";

export const TASK_SCHEMA = `
CREATE TABLE IF NOT EXISTS lw_tasks (
    channel      TEXT NOT NULL,
    task_id      TEXT NOT NULL,
    user_id      BIGINT NOT NULL REFERENCES lw_users(id) ON DELETE CASCADE,
    ref          TEXT NOT NULL,
    amount_milli BIGINT NOT NULL,
    note         TEXT NOT NULL DEFAULT '',
    status       TEXT NOT NULL DEFAULT 'pending',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (channel, task_id)
);
`;

const FAILED = new Set(["failed", "failure", "fail", "error", "cancelled", "canceled", "expired", "violation"]);
const SUCCEEDED = new Set(["completed", "succeeded", "success", "done", "finished"]);

const isObject = (v) => v && typeof v === "object" && !Array.isArray(v);

// The objects a provider may put the task in: root, data, data[0], result, data.data.
function candidates(payload) {
    const out = [];
    const push = (v) => { if (Array.isArray(v)) v = v[0]; if (isObject(v)) out.push(v); };
    push(payload?.data?.data);
    push(payload?.data);
    push(payload?.result);
    push(payload);
    return out;
}

export function findTaskId(payload) {
    for (const item of candidates(payload)) {
        for (const key of ["task_id", "taskId", "id"]) {
            const v = item[key];
            if ((typeof v === "string" && v.trim()) || typeof v === "number") return String(v).trim();
        }
    }
    return "";
}

function hasImage(record) {
    const text = JSON.stringify(record);
    return /https?:\/\/|"b64_json"|base64|"inline_?[dD]ata"/.test(text);
}

// "failed", "succeeded" or "pending" for a status response.
export function taskOutcome(payload) {
    for (const item of candidates(payload)) {
        const raw = item.status ?? item.state ?? item.task_status;
        if (typeof raw !== "string" || !raw.trim()) {
            if (typeof item.errorCode === "string" && item.errorCode.trim()) return "failed";
            continue;
        }
        const status = raw.trim().toLowerCase();
        if (FAILED.has(status)) return "failed";
        if (SUCCEEDED.has(status)) return hasImage(item) ? "succeeded" : "failed";
        return "pending";
    }
    return "pending";
}

export async function recordTask(db, { channel, taskId, userId, ref, amount, note }) {
    await db.query(
        `INSERT INTO lw_tasks (channel, task_id, user_id, ref, amount_milli, note)
         VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (channel, task_id) DO NOTHING`,
        [channel, taskId, userId, ref, amount, note],
    );
}

// Applies a status check. Refunds once when the task failed.
export async function settleTask(db, channel, taskId, outcome) {
    if (!taskId || outcome === "pending") return null;
    const next = outcome === "failed" ? "refunded" : "done";
    const rows = await db.query(
        `UPDATE lw_tasks SET status = $3, updated_at = now()
         WHERE channel = $1 AND task_id = $2 AND status = 'pending'
         RETURNING user_id, ref, amount_milli, note`,
        [channel, taskId, next],
    );
    const task = rows[0];
    if (!task || outcome !== "failed") return task ? "done" : null;
    await adjustBalance(db, Number(task.user_id), Number(task.amount_milli), {
        kind: "refund",
        note: `${task.note}（任务失败自动退回）`,
        ref: task.ref,
    });
    return "refunded";
}
