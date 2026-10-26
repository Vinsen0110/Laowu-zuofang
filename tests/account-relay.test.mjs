import assert from "node:assert/strict";
import test from "node:test";

import { saveChannel, savePrice } from "../account/channels.js";
import { openMemoryDatabase } from "../account/db.js";
import { channelForUrl, describeRequest, relay } from "../account/relay.js";
import { adjustBalance, ledger, register, userFromSession, login } from "../account/service.js";

const db = await openMemoryDatabase();
test.after(() => db.close());

await register(db, { email: "payer@test.com", password: "password123" });
const { token } = await login(db, { email: "payer@test.com", password: "password123" });
const user = await userFromSession(db, token);
await saveChannel(db, { id: "apimart", apiKey: "sk-site-key" });
await savePrice(db, { channel: "apimart", model: "gemini-3-pro-image-preview", spec: "", price: "0.2" });
await savePrice(db, { channel: "apimart", model: "gemini-3-pro-image-preview", spec: "4k", price: "0.5" });

const GEN_URL = "https://api.apimart.ai/v1/images/generations";

function relayRequest(target, { method = "POST", body } = {}) {
    return new Request(`http://127.0.0.1:4173/api/account/relay?url=${encodeURIComponent(target)}`, {
        method,
        headers: { "Content-Type": "application/json", Authorization: "Bearer lw-balance" },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
}

async function balance() {
    return (await userFromSession(db, token)).balanceMilli;
}

function upstream(status, seen) {
    return async (target, init) => {
        seen?.push({ target: String(target), auth: init.headers.get("authorization"), body: init.body });
        return new Response(JSON.stringify({ ok: status < 400 }), { status, headers: { "Content-Type": "application/json" } });
    };
}

test("only known provider hosts are allowed", () => {
    assert.equal(channelForUrl(GEN_URL).channel, "apimart");
    assert.equal(channelForUrl("https://api-hk.soonstudio.ai/v1beta/models/x:generateContent").channel, "soon");
    assert.equal(channelForUrl("https://www.runninghub.ai/openapi/v2/query").channel, "runninghub");
    assert.throws(() => channelForUrl("https://evil.example/v1"), /不支持/);
    assert.throws(() => channelForUrl("http://api.apimart.ai/v1"), /不正确/);
});

test("model, spec and count are read from body or path", () => {
    const u = (s) => new URL(s);
    assert.deepEqual(describeRequest(u(GEN_URL), { model: "m", resolution: "4K", n: 2 }), { model: "m", spec: "4k", count: 2 });
    assert.deepEqual(
        describeRequest(u("https://api.soonstudio.ai/v1beta/models/nano-pro:generateContent"), { generationConfig: { imageConfig: { imageSize: "2K" } } }),
        { model: "nano-pro", spec: "2k", count: 1 },
    );
    assert.deepEqual(
        describeRequest(u("https://www.runninghub.ai/openapi/v2/rhart-image-n-pro/text-to-image"), { resolution: "1k" }),
        { model: "rhart-image-n-pro", spec: "1k", count: 1 },
    );
    assert.equal(describeRequest(u(GEN_URL), { model: "a", n: 99 }).count, 10);
});

test("charges the matching price and calls upstream with the site key", async () => {
    await adjustBalance(db, user.id, 1000, { kind: "admin", note: "test" });
    const seen = [];
    const res = await relay(db, user, relayRequest(GEN_URL, { body: { model: "gemini-3-pro-image-preview", resolution: "4K" } }), { fetchImpl: upstream(200, seen) });
    assert.equal(res.status, 200);
    assert.equal(seen[0].auth, "Bearer sk-site-key");
    assert.equal(await balance(), 500);
    const [last] = await ledger(db, user.id, 1);
    assert.equal(last.kind, "usage");
    assert.equal(last.amount, -0.5);
});

test("falls back to the price without spec", async () => {
    const before = await balance();
    await relay(db, user, relayRequest(GEN_URL, { body: { model: "gemini-3-pro-image-preview", resolution: "2k" } }), { fetchImpl: upstream(200) });
    assert.equal(await balance(), before - 200);
});

test("refunds when the provider rejects the request", async () => {
    const before = await balance();
    const res = await relay(db, user, relayRequest(GEN_URL, { body: { model: "gemini-3-pro-image-preview" } }), { fetchImpl: upstream(500) });
    assert.equal(res.status, 500);
    assert.equal(await balance(), before);
    const [last] = await ledger(db, user.id, 1);
    assert.equal(last.kind, "refund");
});

test("refunds when the provider cannot be reached", async () => {
    const before = await balance();
    await assert.rejects(
        relay(db, user, relayRequest(GEN_URL, { body: { model: "gemini-3-pro-image-preview" } }), { fetchImpl: async () => { throw new Error("down"); } }),
        /已退回/,
    );
    assert.equal(await balance(), before);
});

test("rejects unpriced models and insufficient balance without calling upstream", async () => {
    const seen = [];
    await assert.rejects(
        relay(db, user, relayRequest(GEN_URL, { body: { model: "unknown-model" } }), { fetchImpl: upstream(200, seen) }),
        /还没开放余额生成（渠道 2 \/ unknown-model）/,
    );
    await savePrice(db, { channel: "apimart", model: "pricey", price: "100" });
    await assert.rejects(
        relay(db, user, relayRequest(GEN_URL, { body: { model: "pricey" } }), { fetchImpl: upstream(200, seen) }),
        /余额不足/,
    );
    assert.equal(seen.length, 0);
});

test("polling and uploads are free", async () => {
    const before = await balance();
    await relay(db, user, relayRequest("https://api.apimart.ai/v1/tasks/abc", { method: "GET" }), { fetchImpl: upstream(200) });
    await relay(db, user, relayRequest("https://www.runninghub.ai/openapi/v2/query", { body: { taskId: "1" } }), { fetchImpl: upstream(200) })
        .catch((error) => assert.match(error.message, /暂时不能用/));
    assert.equal(await balance(), before);
});

test("channels without a site key are refused", async () => {
    await assert.rejects(
        relay(db, user, relayRequest("https://grsaiapi.com/v1/api/generate", { body: { model: "nano-banana-pro" } }), { fetchImpl: upstream(200) }),
        /暂时不能用余额生成/,
    );
});

test("every catalog row can be priced and charged through the relay", async () => {
    const { priceCatalog } = await import("../account/catalog.js");
    const { savePrices } = await import("../account/channels.js");
    const rows = priceCatalog();
    assert.ok(rows.length > 50);
    const keys = new Set(rows.map((r) => `${r.channel}|${r.model}|${r.spec}`));
    assert.equal(keys.size, rows.length);
    await savePrices(db, rows.map((r, i) => ({ channel: r.channel, model: r.model, spec: r.spec, price: (i + 1) / 1000 })));
    const { findPrice } = await import("../account/relay.js");
    for (const [i, r] of rows.entries()) assert.equal(await findPrice(db, r.channel, r.model, r.spec), i + 1, `${r.label} ${r.spec}`);
    // Tudou GPT 2.5 request as the canvas sends it → its catalog row
    const body = { model: "gpt-image-2.5-sunburst-async", resolution: "4k", quality: "xhigh", prompt: "x" };
    const d = describeRequest(new URL("https://api.ai-tudou.net/v1/images/generations/async"), body);
    assert.ok(keys.has(`tudou|${d.model}|${d.spec}`));
    // clearing a price removes it
    await savePrices(db, [{ channel: rows[0].channel, model: rows[0].model, spec: rows[0].spec, price: "" }]);
    assert.equal(await findPrice(db, rows[0].channel, rows[0].model, rows[0].spec), null);
});

test("quality-specific prices fall back to the resolution price", async () => {
    const { findPrice } = await import("../account/relay.js");
    await savePrice(db, { channel: "tudou", model: "fallback-model", spec: "2k", price: "0.3" });
    assert.equal(await findPrice(db, "tudou", "fallback-model", "2k/high"), 300);
    await savePrice(db, { channel: "tudou", model: "fallback-model", spec: "2k/high", price: "0.4" });
    assert.equal(await findPrice(db, "tudou", "fallback-model", "2k/high"), 400);
});

test("adding an email to LW_ADMIN_EMAILS promotes the existing account", async () => {
    const before = process.env.LW_ADMIN_EMAILS;
    assert.equal((await userFromSession(db, token)).role, "user");
    process.env.LW_ADMIN_EMAILS = "someone@else.com, PAYER@test.com";
    assert.equal((await userFromSession(db, token)).role, "admin");
    process.env.LW_ADMIN_EMAILS = before ?? "";
});

test("Grsai keeps an optional second key and uses it for the account balance", async () => {
    const { channelBalances, listChannels } = await import("../account/channels.js");
    await saveChannel(db, { id: "grsai", apiKey: "sk-grsai", apiKey2: "account-token" });
    const grsai = (await listChannels(db)).find((c) => c.id === "grsai");
    assert.equal(grsai.hasKey2, true);
    assert.ok(grsai.extraKey);
    assert.equal(grsai.baseUrl, "");
    const seen = [];
    await channelBalances(db, { fetchImpl: async (url, init) => {
        seen.push({ url: String(url), body: init?.body });
        return new Response(JSON.stringify({ code: 0, data: { credits: 12345 } }), { headers: { "Content-Type": "application/json" } });
    } });
    const call = seen.find((s) => s.url.includes("grsai"));
    assert.match(call.url, /getCredits$/);
    assert.match(call.body, /account-token/);
});

test("deleting a user: refuses admins and accounts with balance", async () => {
    const { deleteUser } = await import("../account/service.js");
    const extra = await register(db, { email: "gone@test.com", password: "password123" });
    await adjustBalance(db, extra.id, 100, { kind: "admin", note: "t" });
    await assert.rejects(deleteUser(db, extra.id), /还有余额/);
    await adjustBalance(db, extra.id, -100, { kind: "admin", note: "t" });
    await deleteUser(db, extra.id);
    assert.equal((await db.query("SELECT 1 FROM lw_users WHERE id = $1", [extra.id])).length, 0);
    assert.equal((await db.query("SELECT 1 FROM lw_ledger WHERE user_id = $1", [extra.id])).length, 0);
});

test("reads are limited to task polling; balance endpoints are blocked", async () => {
    await assert.rejects(
        relay(db, user, relayRequest("https://api.apimart.ai/v1/user/balance", { method: "GET" }), { fetchImpl: upstream(200) }),
        /不能通过余额调用/,
    );
    await assert.rejects(
        relay(db, user, relayRequest("https://api.ai-tudou.net/api/usage/token/", { method: "GET" }), { fetchImpl: upstream(200) }),
        /不能通过余额调用/,
    );
    const ok = await relay(db, user, relayRequest("https://api.apimart.ai/v1/tasks/abc?language=zh", { method: "GET" }), { fetchImpl: upstream(200) });
    assert.equal(ok.status, 200);
});

test("official GPT 2.5 is admin-only, and admin generations are free", async () => {
    const seen = [];
    await assert.rejects(
        relay(db, { ...user, role: "user" }, relayRequest(GEN_URL, { body: { model: "gpt-image-2.5-flare", quality: "high" } }), { fetchImpl: upstream(200, seen) }),
        /仅管理员可用/,
    );
    assert.equal(seen.length, 0);
    const before = await balance();
    const res = await relay(db, { ...user, role: "admin" }, relayRequest(GEN_URL, { body: { model: "gpt-image-2.5-flare", quality: "high" } }), { fetchImpl: upstream(200, seen) });
    assert.equal(res.status, 200);
    assert.equal(seen[0].auth, "Bearer sk-site-key");
    assert.equal(await balance(), before);
});

test("admin Cloudinary is saved on the server and used when the canvas has none", async () => {
    const { getCloudinary, saveCloudinary } = await import("../account/channels.js");
    const { cloudinaryCredentials } = await import("../cloudinary-reference-upload.js");
    await saveCloudinary(db, { cloudName: "site-cloud", apiKey: "12345", apiSecret: "s3cret" });
    await saveCloudinary(db, { cloudName: "site-cloud", apiKey: "12345", apiSecret: "" }); // empty keeps the secret
    assert.deepEqual(await getCloudinary(db), { cloudName: "site-cloud", apiKey: "12345", apiSecret: "s3cret" });
    await assert.rejects(saveCloudinary(db, { apiKey: "abc" }), /纯数字/);
    assert.throws(() => cloudinaryCredentials({}), /图床设置/);
    globalThis.__lwCloudinary = await getCloudinary(db);
    try {
        assert.equal(cloudinaryCredentials({}).cloudName, "site-cloud");
        assert.equal(cloudinaryCredentials({ cloudinaryCloudName: "mine", cloudinaryApiKey: "9", cloudinaryApiSecret: "x" }).cloudName, "mine");
    } finally {
        globalThis.__lwCloudinary = null;
    }
});

test("balance refresh can target a single site", async () => {
    const { channelBalances, listChannels } = await import("../account/channels.js");
    const seen = [];
    const result = await channelBalances(db, { ids: ["apimart"], fetchImpl: async (url) => {
        seen.push(String(url));
        return new Response(JSON.stringify({ data: { remain_balance: 3 } }), { headers: { "Content-Type": "application/json" } });
    } });
    assert.deepEqual(result.items.map((i) => i.id), ["apimart"]);
    assert.ok(seen.every((u) => u.includes("apimart")));
    assert.equal((await listChannels(db)).find((c) => c.id === "runninghub").channelLabel, "渠道 4");
});

test("users never see supplier hosts: masked targets, scrubbed errors, proxied result URLs", async () => {
    const { maskTarget, unmaskTarget, imageToken, verifyImageToken, scrubText } = await import("../account/mask.js");
    assert.equal(unmaskTarget(maskTarget(GEN_URL)), GEN_URL);
    assert.ok(!maskTarget(GEN_URL).includes("apimart"));
    assert.equal(scrubText("apimart_error: invalid key at https://api.apimart.ai/x"), "渠道 2_error: invalid key at [链接已隐藏]");
    const token = imageToken("https://cdn.example.com/a.png");
    assert.equal(verifyImageToken(token), "https://cdn.example.com/a.png");
    assert.equal(verifyImageToken(token.replace(/.$/, "x")), null);

    await adjustBalance(db, user.id, 2000, { kind: "admin", note: "t" });
    const masked = new Request(`http://127.0.0.1:4173/api/account/relay?t=${maskTarget(GEN_URL)}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model: "gemini-3-pro-image-preview" }),
    });
    const ok = await relay(db, { ...user, role: "user" }, masked, { fetchImpl: async () => new Response(
        JSON.stringify({ data: { url: "https://upload.apimart.ai/r/1.png" } }), { headers: { "Content-Type": "application/json" } }) });
    const body = await ok.json();
    assert.match(body.data.url, /^http:\/\/127\.0\.0\.1:4173\/api\/account\/img\?t=/);
    assert.ok(!JSON.stringify(body).includes("apimart"));

    const bad = await relay(db, { ...user, role: "user" }, relayRequest(GEN_URL, { body: { model: "gemini-3-pro-image-preview" } }), { fetchImpl: async () => new Response(
        JSON.stringify({ error: { message: "apimart upstream busy", type: "apimart_error" } }), { status: 503, headers: { "Content-Type": "application/json" } }) });
    assert.equal(bad.status, 503);
    assert.equal(bad.headers.get("x-lw-refund"), "0.2");
    assert.equal((await bad.json()).error.message, "平台繁忙或超时（503），请稍后重试。本次费用 0.2 已退回余额");
});

test("a synchronous Gemini answer without an image is refunded", async () => {
    await savePrice(db, { channel: "apimart", model: "nano-sync", spec: "", price: "0.2" });
    const target = "https://api.apimart.ai/v1beta/models/nano-sync:generateContent";
    const before = await balance();
    const res = await relay(db, { ...user, role: "user" }, relayRequest(target, { body: {} }), { fetchImpl: async () => new Response(
        JSON.stringify({ candidates: [{ finishReason: "SAFETY", content: { parts: [{ text: "blocked" }] } }] }), { headers: { "Content-Type": "application/json" } }) });
    await res.text();
    assert.equal(await balance(), before);
    const withImage = await relay(db, { ...user, role: "user" }, relayRequest(target, { body: {} }), { fetchImpl: async () => new Response(
        JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: "AAAA" } }] } }] }), { headers: { "Content-Type": "application/json" } }) });
    await withImage.text();
    assert.equal(await balance(), before - 200);
});

test("async tasks: a failed status check refunds once; success keeps the charge", async () => {
    const { taskOutcome, findTaskId } = await import("../account/tasks.js");
    assert.equal(findTaskId({ code: 200, data: [{ status: "submitted", task_id: "t-1" }] }), "t-1");
    assert.equal(findTaskId({ data: { taskId: "rh-1" } }), "rh-1");
    assert.equal(taskOutcome({ data: { status: "FAILURE", fail_reason: "x" } }), "failed");
    assert.equal(taskOutcome({ data: { status: "FAILED" } }), "failed");
    assert.equal(taskOutcome({ data: { status: "violation" } }), "failed");
    assert.equal(taskOutcome({ data: { status: "completed", result: { images: [{ url: ["https://cdn/x.png"] }] } } }), "succeeded");
    assert.equal(taskOutcome({ data: { status: "completed", result: {} } }), "failed");
    assert.equal(taskOutcome({ data: { status: "processing" } }), "pending");

    const asUser = { ...user, role: "user" };
    await savePrice(db, { channel: "apimart", model: "async-model", spec: "", price: "0.3" });
    await adjustBalance(db, user.id, 3000, { kind: "admin", note: "t" });
    const json = (body, status = 200) => async () => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

    // submit → charged and recorded
    let before = await balance();
    await (await relay(db, asUser, relayRequest(GEN_URL, { body: { model: "async-model" } }), { fetchImpl: json({ code: 200, data: [{ status: "submitted", task_id: "job-fail" }] }) })).text();
    assert.equal(await balance(), before - 300);
    // still running → nothing
    await (await relay(db, asUser, relayRequest("https://api.apimart.ai/v1/tasks/job-fail", { method: "GET" }), { fetchImpl: json({ data: { status: "processing" } }) })).text();
    assert.equal(await balance(), before - 300);
    // failed → refunded, and only once
    await (await relay(db, asUser, relayRequest("https://api.apimart.ai/v1/tasks/job-fail", { method: "GET" }), { fetchImpl: json({ data: { status: "failed", error: { message: "x" } } }) })).text();
    assert.equal(await balance(), before);
    await (await relay(db, asUser, relayRequest("https://api.apimart.ai/v1/tasks/job-fail", { method: "GET" }), { fetchImpl: json({ data: { status: "failed" } }) })).text();
    assert.equal(await balance(), before);
    const [last] = await ledger(db, user.id, 1);
    assert.match(last.note, /任务失败自动退回/);

    // success keeps the charge
    before = await balance();
    await (await relay(db, asUser, relayRequest(GEN_URL, { body: { model: "async-model" } }), { fetchImpl: json({ data: { task_id: "job-ok" } }) })).text();
    await (await relay(db, asUser, relayRequest("https://api.apimart.ai/v1/tasks/job-ok", { method: "GET" }), { fetchImpl: json({ data: { status: "completed", result: { images: [{ url: "https://cdn/a.png" }] } } }) })).text();
    assert.equal(await balance(), before - 300);

    // a submit that already says it failed is refunded right away
    before = await balance();
    await (await relay(db, asUser, relayRequest(GEN_URL, { body: { model: "async-model" } }), { fetchImpl: json({ code: 500, error: { message: "busy" } }) })).text();
    assert.equal(await balance(), before);
});

test("RunningHub status checks send the task id in the POST body", async () => {
    await saveChannel(db, { id: "runninghub", apiKey: "rh-key" });
    await savePrice(db, { channel: "runninghub", model: "rhart-image-n-pro", spec: "", price: "0.5" });
    const asUser = { ...user, role: "user" };
    const json = (body) => async () => new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
    const before = await balance();
    await (await relay(db, asUser, relayRequest("https://www.runninghub.ai/openapi/v2/rhart-image-n-pro/text-to-image", { body: { prompt: "x" } }), { fetchImpl: json({ taskId: "rh-77", status: "QUEUED" }) })).text();
    assert.equal(await balance(), before - 500);
    await (await relay(db, asUser, relayRequest("https://www.runninghub.ai/openapi/v2/query", { body: { taskId: "rh-77" } }), { fetchImpl: json({ status: "FAILED", errorCode: "E1" }) })).text();
    assert.equal(await balance(), before);
});

test("low supplier balance emails the admins once, then again only after recovery", async () => {
    const { checkLowBalances } = await import("../account/alerts.js");
    const prev = process.env.LW_ADMIN_EMAILS;
    process.env.LW_ADMIN_EMAILS = "owner@qq.com";
    await saveChannel(db, { id: "apimart", apiKey: "sk-site-key", alertThreshold: 5 });
    const sent = [];
    const send = async (to, mail) => { sent.push({ to, subject: mail.subject }); };
    const balanceOf = (v) => async () => new Response(JSON.stringify({ data: { remain_balance: v } }), { headers: { "Content-Type": "application/json" } });
    try {
        await checkLowBalances(db, { ids: ["apimart"], minIntervalMs: 0, fetchImpl: balanceOf(1), send });
        assert.equal(sent.length, 1);
        assert.deepEqual(sent[0].to, ["owner@qq.com"]);
        assert.match(sent[0].subject, /APIMart.*余额不足/);
        await checkLowBalances(db, { ids: ["apimart"], minIntervalMs: 0, fetchImpl: balanceOf(1), send });
        assert.equal(sent.length, 1, "no repeat within 12 hours");
        await checkLowBalances(db, { ids: ["apimart"], minIntervalMs: 0, fetchImpl: balanceOf(50), send });
        await checkLowBalances(db, { ids: ["apimart"], minIntervalMs: 0, fetchImpl: balanceOf(2), send });
        assert.equal(sent.length, 2, "alerts again after the balance recovered and dropped");
        const throttled = await checkLowBalances(db, { ids: ["apimart"], fetchImpl: balanceOf(2), send });
        assert.deepEqual(throttled.checked, [], "per-site checks are throttled");
    } finally {
        process.env.LW_ADMIN_EMAILS = prev ?? "";
    }
});

test("removing an email from LW_ADMIN_EMAILS takes admin away (but an empty list never does)", async () => {
    const prev = process.env.LW_ADMIN_EMAILS;
    try {
        process.env.LW_ADMIN_EMAILS = "payer@test.com";
        assert.equal((await userFromSession(db, token)).role, "admin");
        process.env.LW_ADMIN_EMAILS = "";
        assert.equal((await userFromSession(db, token)).role, "admin");
        process.env.LW_ADMIN_EMAILS = "someone@else.com";
        assert.equal((await userFromSession(db, token)).role, "user");
    } finally {
        process.env.LW_ADMIN_EMAILS = prev ?? "";
    }
});

test("users can set a nickname that the admin user list shows and searches", async () => {
    const { setDisplayName, listUsers } = await import("../account/service.js");
    const updated = await setDisplayName(db, user.id, "  小明<script>  ");
    assert.equal(updated.displayName, "小明script");
    assert.equal(updated.customName, "小明script");
    const [found] = await listUsers(db, { search: "小明" });
    assert.equal(found.email, "payer@test.com");
    assert.equal((await setDisplayName(db, user.id, "")).displayName, "payer");
});

test("renumbering users keeps balances, ledgers, sessions, codes and tasks attached", async () => {
    const { renumberUsers, createCodes, redeemCode, register, login, userFromSession, deleteUser } = await import("../account/service.js");
    const { recordTask } = await import("../account/tasks.js");
    const a = await register(db, { email: "renum-a@test.com", password: "password123" });
    const gone = await register(db, { email: "renum-gone@test.com", password: "password123" });
    const b = await register(db, { email: "renum-b@test.com", password: "password123" });
    await deleteUser(db, gone.id);
    const { codes } = await createCodes(db, { count: 1, amountYuan: 3, batch: "renum" });
    await redeemCode(db, b.id, codes[0]);
    await recordTask(db, { channel: "apimart", taskId: "renum-task", userId: b.id, ref: "r", amount: 1, note: "n" });
    const { token: bToken } = await login(db, { email: "renum-b@test.com", password: "password123" });

    const before = (await db.query("SELECT username FROM lw_users ORDER BY id")).map((r) => r.username);
    const result = await renumberUsers(db);
    const after = await db.query("SELECT id, username FROM lw_users ORDER BY id");
    assert.deepEqual(after.map((r) => r.username), before, "sign-up order kept");
    assert.deepEqual(after.map((r) => Number(r.id)), after.map((_, i) => i + 1), "ids are 1..n with no gaps");
    assert.equal(result.users, after.length);

    const me = await userFromSession(db, bToken);
    assert.equal(me.email, "renum-b@test.com", "still signed in");
    assert.equal(me.balance, 3);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM lw_ledger WHERE user_id = $1", [me.id]))[0].n, 1);
    assert.equal(Number((await db.query("SELECT used_by FROM lw_codes WHERE code = $1", [codes[0]]))[0].used_by), me.id);
    assert.equal(Number((await db.query("SELECT user_id FROM lw_tasks WHERE task_id = 'renum-task'"))[0].user_id), me.id);
    const next = await register(db, { email: "renum-next@test.com", password: "password123" });
    assert.equal(next.id, after.length + 1, "new sign-ups continue after the highest id");
    assert.ok(a);
});

test("Tudou Gemini references are fetched by the relay, so the browser uploads them only once", async () => {
    await saveChannel(db, { id: "tudou", apiKey: "sk-tudou" });
    await savePrice(db, { channel: "tudou", model: "gemini-3-pro-image-preview", spec: "2k", price: "0.3" });
    await adjustBalance(db, user.id, 1000, { kind: "admin", note: "t" });
    const ref = "https://res.cloudinary.com/test-cloud/image/upload/v1/laowu-reference/a.webp";
    const target = "https://api.ai-tudou.net/v1beta/models/gemini-3-pro-image-preview:generateContent";
    const sent = [];
    // 土豆 is called from the browser; the relay is the fallback before the browser has the key.
    const response = await relay(db, { ...user, role: "user" }, relayRequest(target, { body: {
        contents: [{ parts: [{ text: "x" }, { fileData: { mimeType: "image/webp", fileUri: ref } }] }],
        generationConfig: { imageConfig: { imageSize: "2K" } },
    } }), { fetchImpl: async (url, init) => {
        if (String(url) === ref) return new Response(new Uint8Array([1, 2, 3]), { headers: { "Content-Type": "image/webp" } });
        sent.push(JSON.parse(new TextDecoder().decode(init.body)));
        return new Response('data: {"candidates":[{"content":{"parts":[{"inlineData":{"data":"AA=="}}]}}]}\n\n', { headers: { "Content-Type": "text/event-stream" } });
    } });
    await response.text();
    assert.equal(sent.length, 1);
    assert.deepEqual(sent[0].contents[0].parts[1], { inlineData: { mimeType: "image/webp", data: "AQID" } });
});

test("a proxied upload or result link sent back as a reference reaches the supplier as its original link", async () => {
    const { imageToken } = await import("../account/mask.js");
    await adjustBalance(db, user.id, 1000, { kind: "admin", note: "t" });
    const original = "https://upload.apimart.ai/f/ref-1.png";
    const proxied = `https://test.vinsen.top/api/account/img?t=${imageToken(original)}`;
    const forged = "https://test.vinsen.top/api/account/img?t=AAAA.bbbb";
    const sent = [];
    await relay(db, { ...user, role: "user" }, relayRequest(GEN_URL, { body: {
        model: "gemini-3-pro-image-preview", prompt: "x", image_urls: [proxied, forged],
    } }), { fetchImpl: async (_url, init) => {
        sent.push(JSON.parse(new TextDecoder().decode(init.body)));
        return new Response(JSON.stringify({ data: { task_id: "t-ref-1" } }), { headers: { "Content-Type": "application/json" } });
    } });
    assert.deepEqual(sent[0].image_urls, [original, forged], "only links this server signed are restored");
});

test("土豆 Nano Banana Pro's stream: the picture goes to COS and the browser gets one event with its link", async () => {
    const { saveCos } = await import("../account/cos.js");
    await saveChannel(db, { id: "tudou", apiKey: "sk-tudou" });
    await savePrice(db, { channel: "tudou", model: "gemini-3-pro-image-preview", spec: "1k", price: "0.4" });
    await saveCos(db, { secretId: "AKIDtest", secretKey: "secret", bucket: "laowu-images-1250000000", region: "ap-guangzhou", delivery: "cos" });
    await adjustBalance(db, user.id, 2000, { kind: "admin", note: "t" });
    const picture = Buffer.from([0x89, 0x50, 0x4e, 0x47, 9, 9, 9, 9]).toString("base64");
    const sse = `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: "ok" }] } }] })}\n\n`
        + `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: picture }, thoughtSignature: "s".repeat(5000) }] } }] })}\n\n`;
    const uploads = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url, init = {}) => {
        if (init.method === "PUT") { uploads.push(String(url)); return new Response("", { status: 200 }); }
        return realFetch(url, init);
    };
    try {
        const target = "https://api.ai-tudou.net/v1beta/models/gemini-3-pro-image-preview:streamGenerateContent?alt=sse";
        const before = await balance();
        const res = await relay(db, { ...user, role: "user" }, relayRequest(target, {
            body: { contents: [{ parts: [{ text: "cat" }] }], generationConfig: { imageConfig: { imageSize: "1K" } } },
        }), { fetchImpl: async () => new Response(sse, { headers: { "Content-Type": "text/event-stream" } }) });
        assert.match(res.headers.get("content-type"), /text\/event-stream/);
        const text = await res.text();
        assert.equal(uploads.length, 1);
        assert.ok(!/inline_?[dD]ata/.test(text), "no picture bytes left in the answer");
        assert.ok(!text.includes("thoughtSignature"));
        const event = JSON.parse(text.trim().replace(/^data: /, ""));
        const part = event.candidates.flatMap((c) => c.content.parts).find((p) => p.fileData);
        assert.match(part.fileData.fileUri, /^https:\/\/laowu-images-1250000000\.cos\.ap-guangzhou\.myqcloud\.com\/results\//);
        assert.equal(await balance(), before - 400, "relay fallback: charged once, not refunded");
    } finally {
        globalThis.fetch = realFetch;
        await saveCos(db, { secretId: "", bucket: "" });
    }
});

test("直连平台: users get the supplier's own result link; switching back restores the proxy", async () => {
    const { saveCos, getCos } = await import("../account/cos.js");
    await adjustBalance(db, user.id, 2000, { kind: "admin", note: "t" });
    const answer = async () => new Response(
        JSON.stringify({ data: { url: "https://upload.apimart.ai/r/2.png" } }), { headers: { "Content-Type": "application/json" } });
    const generate = () => relay(db, { ...user, role: "user" }, relayRequest(GEN_URL, { body: { model: "gemini-3-pro-image-preview" } }), { fetchImpl: answer });

    assert.equal((await getCos(db)).delivery, "cos");
    await saveCos(db, { delivery: "direct" });
    assert.equal((await getCos(db)).delivery, "direct");
    const direct = await (await generate()).json();
    assert.equal(direct.data.url, "https://upload.apimart.ai/r/2.png");

    await saveCos(db, { delivery: "cos" });
    const proxied = await (await generate()).json();
    assert.match(proxied.data.url, /^http:\/\/127\.0\.0\.1:4173\/api\/account\/img\?t=/);
});
