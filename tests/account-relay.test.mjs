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
        /还没开放余额生成（apimart \/ unknown-model）/,
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
