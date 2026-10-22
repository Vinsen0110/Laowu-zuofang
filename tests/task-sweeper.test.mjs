import assert from "node:assert/strict";
import test from "node:test";
import { saveChannel } from "../account/channels.js";
import { openMemoryDatabase } from "../account/db.js";
import { adjustBalance, login, register, userFromSession } from "../account/service.js";
import { recordTask } from "../account/tasks.js";
import { sweepTasks } from "../account/task-sweeper.js";

const db = await openMemoryDatabase();
test.after(() => db.close());
await register(db, { email: "sweep@test.com", password: "password123" });
const { token } = await login(db, { email: "sweep@test.com", password: "password123" });
const user = await userFromSession(db, token);
await saveChannel(db, { id: "apimart", apiKey: "sk-mart" });
await adjustBalance(db, user.id, 1000, { kind: "admin", note: "t" });

async function task(id, minutesAgo) {
    await recordTask(db, { channel: "apimart", taskId: id, userId: user.id, ref: `r-${id}`, amount: 200, note: "apimart test" });
    await db.query(`UPDATE lw_tasks SET created_at = now() - make_interval(mins => $2) WHERE task_id = $1`, [id, minutesAgo]);
}
const balance = async () => (await userFromSession(db, token)).balanceMilli;
const answers = {
    "t-failed": { data: { status: "failed", error: { message: "x" } } },
    "t-done": { data: { status: "completed", result: { images: [{ url: ["https://x.test/a.png"] }] } } },
    "t-running": { data: { status: "processing" } },
    "t-stuck": { data: { status: "processing" } },
    "t-fresh": { data: { status: "failed" } },
};
const fetchImpl = async (url, init) => {
    assert.equal(init.headers.Authorization, "Bearer sk-mart");
    const id = new URL(url).pathname.split("/").pop();
    return Response.json(answers[id]);
};

test("tasks nobody is watching get settled: failed and long-stuck ones are refunded once", async () => {
    await task("t-failed", 10);
    await task("t-done", 10);
    await task("t-running", 10);
    await task("t-stuck", 45);
    await task("t-fresh", 1);
    const before = await balance();
    const summary = await sweepTasks(db, { fetchImpl });
    assert.deepEqual(summary, { checked: 4, done: 1, refunded: 2, pending: 1 });
    assert.equal(await balance(), before + 400);
    const again = await sweepTasks(db, { fetchImpl });
    assert.equal(again.refunded, 0, "never refunded twice");
    assert.equal(await balance(), before + 400);
    const rows = await db.query("SELECT task_id, status FROM lw_tasks ORDER BY task_id");
    assert.deepEqual(Object.fromEntries(rows.map(r => [r.task_id, r.status])), {
        "t-done": "done", "t-failed": "refunded", "t-fresh": "pending", "t-running": "pending", "t-stuck": "refunded",
    });
});
