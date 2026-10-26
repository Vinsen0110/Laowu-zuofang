import assert from "node:assert/strict";
import test from "node:test";

import { openMemoryDatabase } from "../account/db.js";
import { handleAccountRequest } from "../account/http.js";
import {
    adjustBalance,
    createCodes,
    deleteCode,
    login,
    normalizeCode,
    redeemCode,
    register,
    userFromSession,
    yuanToMilli,
} from "../account/service.js";

process.env.LW_ADMIN_EMAILS = "boss@test.com";
const db = await openMemoryDatabase();
test.after(() => db.close());

function call(path, { method = "GET", body, cookie, origin } = {}) {
    const headers = new Headers({ "Content-Type": "application/json" });
    if (cookie) headers.set("Cookie", cookie);
    if (origin) headers.set("Origin", origin);
    return handleAccountRequest(new Request(`http://127.0.0.1:4173/api/account${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
    }), { db });
}

function cookieOf(response) {
    return (response.headers.get("set-cookie") || "").split(";")[0];
}

test("money is stored as integer milli-yuan", () => {
    assert.equal(yuanToMilli("0.035"), 35);
    assert.equal(yuanToMilli(10), 10000);
    assert.equal(yuanToMilli("0.1") + yuanToMilli("0.2"), 300);
});

test("register, login and session", async () => {
    const user = await register(db, { email: "alice@test.com", password: "password123" });
    assert.equal(user.role, "user");
    assert.equal(user.balance, 0);
    await assert.rejects(register(db, { email: "ALICE@test.com", password: "password123" }), /已经注册过/);
    await assert.rejects(register(db, { email: "ab", password: "password123" }), /邮箱/);
    await assert.rejects(register(db, { email: "bob@test.com", password: "short" }), /密码/);
    await assert.rejects(login(db, { email: "alice@test.com", password: "wrong-pass" }), /不正确/);
    const { token } = await login(db, { email: "Alice@test.com", password: "password123" });
    const me = await userFromSession(db, token);
    assert.equal(me.email, "alice@test.com");
    assert.equal(me.displayName, "alice");
    assert.equal(await userFromSession(db, "nope"), null);
});

test("admin role comes from LW_ADMIN_EMAILS", async () => {
    const boss = await register(db, { email: "boss@test.com", password: "password123" });
    assert.equal(boss.role, "admin");
});

test("balance never goes negative and every change is in the ledger", async () => {
    const u = await register(db, { email: "carol@test.com", password: "password123" });
    assert.equal(await adjustBalance(db, u.id, 5000, { kind: "admin" }), 5000);
    assert.equal(await adjustBalance(db, u.id, -6000, { kind: "usage" }), null);
    assert.equal(await adjustBalance(db, u.id, -1500, { kind: "usage" }), 3500);
    const rows = await db.query("SELECT delta_milli FROM lw_ledger WHERE user_id = $1 ORDER BY id", [u.id]);
    assert.deepEqual(rows.map((r) => Number(r.delta_milli)), [5000, -1500]);
});

test("redeem codes work once only", async () => {
    const u = await register(db, { email: "dave@test.com", password: "password123" });
    const { codes } = await createCodes(db, { count: 3, amountYuan: "20", batch: "test" });
    assert.equal(codes.length, 3);
    assert.match(codes[0], /^LW-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    assert.equal(normalizeCode(codes[0].toLowerCase().replaceAll("-", " ")), codes[0]);
    const first = await redeemCode(db, u.id, codes[0]);
    assert.deepEqual(first, { amount: 20, balance: 20 });
    await assert.rejects(redeemCode(db, u.id, codes[0]), /已经被使用/);
    await assert.rejects(redeemCode(db, u.id, "LW-AAAA-BBBB-CCCC-DDDD"), /不存在/);
    // Two people racing for the same code: exactly one wins.
    const e = await register(db, { email: "erin@test.com", password: "password123" });
    const results = await Promise.allSettled([redeemCode(db, u.id, codes[1]), redeemCode(db, e.id, codes[1])]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
});

test("codes can be deleted, used or not, without touching balances", async () => {
    const u = await register(db, { email: "hank@test.com", password: "password123" });
    const { codes } = await createCodes(db, { count: 2, amountYuan: "10", batch: "del" });
    await deleteCode(db, codes[0]);
    await assert.rejects(redeemCode(db, u.id, codes[0]), /不存在/);
    await redeemCode(db, u.id, codes[1]);
    await deleteCode(db, codes[1]);
    const after = await db.query("SELECT balance_milli FROM lw_users WHERE id = $1", [u.id]);
    assert.equal(Number(after[0].balance_milli), 10000);
    const ledgerRows = await db.query("SELECT count(*) AS n FROM lw_ledger WHERE user_id = $1 AND kind = 'redeem'", [u.id]);
    assert.equal(Number(ledgerRows[0].n), 1);
    await assert.rejects(deleteCode(db, "LW-AAAA-BBBB-CCCC-DDDD"), /不存在/);
});

test("HTTP flow: register → redeem → admin top-up", async () => {
    let res = await call("/me");
    assert.deepEqual(await res.json(), { user: null });

    res = await call("/register", { method: "POST", body: { email: "frank@test.com", password: "password123", code: "000000" } });
    assert.equal(res.status, 400); // no code requested yet
    res = await call("/send-code", { method: "POST", body: { email: "frank@test.com", purpose: "register" } });
    const { devCode } = await res.json();
    assert.match(devCode, /^\d{6}$/);
    res = await call("/register", { method: "POST", body: { email: "frank@test.com", password: "password123", code: devCode } });
    assert.equal(res.status, 200);
    const frankCookie = cookieOf(res);
    assert.match(res.headers.get("set-cookie"), /HttpOnly/);

    res = await call("/admin/stats", { cookie: frankCookie });
    assert.equal(res.status, 403);

    const bossLogin = await call("/login", { method: "POST", body: { email: "boss@test.com", password: "password123" } });
    const bossCookie = cookieOf(bossLogin);
    res = await call("/admin/codes", { method: "POST", cookie: bossCookie, body: { count: 1, amountYuan: 50 } });
    const { codes } = await res.json();

    res = await call("/redeem", { method: "POST", cookie: frankCookie, body: { code: codes[0] } });
    assert.deepEqual(await res.json(), { amount: 50, balance: 50 });

    const frank = (await (await call("/me", { cookie: frankCookie })).json()).user;
    res = await call("/admin/balance", { method: "POST", cookie: bossCookie, body: { userId: frank.id, amountYuan: "12.5" } });
    assert.deepEqual(await res.json(), { balance: 62.5 });
    res = await call("/admin/balance", { method: "POST", cookie: bossCookie, body: { userId: frank.id, amountYuan: -100 } });
    assert.equal(res.status, 400);

    res = await call("/ledger", { cookie: frankCookie });
    const { items } = await res.json();
    assert.deepEqual(items.map((i) => i.kind), ["admin", "redeem"]);

    res = await call("/redeem", { method: "POST", cookie: frankCookie, origin: "https://evil.example", body: { code: "x" } });
    assert.equal(res.status, 403);

    res = await call("/logout", { method: "POST", cookie: frankCookie });
    res = await call("/me", { cookie: frankCookie });
    assert.deepEqual(await res.json(), { user: null });
});

test("Vercel rewrite form (?path=) is understood", async () => {
    const res = await handleAccountRequest(new Request("https://example.com/api/account?path=me"), { db });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { user: null });
});

test("repeated wrong passwords lock the account for a while", async () => {
    await register(db, { email: "gina@test.com", password: "password123" });
    for (let i = 0; i < 8; i++) {
        await assert.rejects(login(db, { email: "gina@test.com", password: "wrong-pass" }));
    }
    await assert.rejects(login(db, { email: "gina@test.com", password: "password123" }), /尝试次数过多/);
});

test("channel keys stay on the server and balances flag low channels", async () => {
    const { saveChannel, listChannels, channelBalances } = await import("../account/channels.js");
    await saveChannel(db, { id: "tudou", apiKey: "sk-tudou-1234567890", alertThreshold: 10 });
    await saveChannel(db, { id: "apimart", apiKey: "sk-mart-abcdefgh", alertThreshold: 2 });
    await assert.rejects(saveChannel(db, { id: "nope" }), /未知的渠道/);
    const list = await listChannels(db);
    const tudou = list.find((c) => c.id === "tudou");
    assert.equal(tudou.keyPreview, "sk-t••••7890");
    assert.equal(JSON.stringify(list).includes("sk-tudou-1234567890"), false);
    // keep key when apiKey is omitted
    await saveChannel(db, { id: "tudou", alertThreshold: 10, baseUrl: "" });
    assert.equal((await listChannels(db)).find((c) => c.id === "tudou").hasKey, true);

    const fakeFetch = async (url) => {
        const u = String(url);
        if (u.includes("ai-tudou")) return Response.json({ data: { total_available: 500000 * 3 } }); // $3
        if (u.includes("apimart")) return Response.json({ data: { remain_balance: 25 } });
        throw new Error("unexpected " + u);
    };
    const { items } = await channelBalances(db, { fetchImpl: fakeFetch });
    const by = Object.fromEntries(items.map((i) => [i.id, i]));
    assert.equal(by.tudou.status, "low");
    assert.equal(by.tudou.balance, 3);
    assert.match(by.tudou.message, /该充值了/);
    assert.equal(by.apimart.status, "ok");
    assert.equal(by.grsai.status, "no_key");
});

test("selling prices: add, update, delete", async () => {
    const { savePrice, listPrices, deletePrice } = await import("../account/channels.js");
    assert.deepEqual(await listPrices(db), []);
    const p = await savePrice(db, { channel: "tudou", model: "nano-banana-pro", spec: "2K", price: "0.8" });
    assert.equal(p.price, 0.8);
    await savePrice(db, { id: p.id, channel: "tudou", model: "nano-banana-pro", spec: "2K", price: "0.9" });
    assert.equal((await listPrices(db))[0].price, 0.9);
    await assert.rejects(savePrice(db, { channel: "tudou", model: "", price: 1 }), /模型名/);
    await deletePrice(db, p.id);
    assert.deepEqual(await listPrices(db), []);
});

test("email codes: wrong tries, resend throttle, one-time use", async () => {
    const { requestCode, consumeCode } = await import("../account/verify.js");
    const sent = [];
    const send = async (to, code, purpose) => { sent.push({ to, code, purpose }); };
    const r = await requestCode(db, { email: "Hana@Test.com", purpose: "register", ip: "1.2.3.4" }, { send });
    assert.equal(sent[0].to, "hana@test.com");
    assert.equal(r.devCode, sent[0].code);
    await assert.rejects(requestCode(db, { email: "hana@test.com", purpose: "register" }, { send }), /秒后再试/);
    const wrong = sent[0].code === "111111" ? "222222" : "111111";
    await assert.rejects(consumeCode(db, { email: "hana@test.com", purpose: "register", code: wrong }), /还可以再试 4 次/);
    assert.equal(await consumeCode(db, { email: "hana@test.com", purpose: "register", code: sent[0].code }), "hana@test.com");
    await assert.rejects(consumeCode(db, { email: "hana@test.com", purpose: "register", code: sent[0].code }), /过期或不存在/);
    await assert.rejects(requestCode(db, { email: "alice@test.com", purpose: "register" }, { send }), /已经注册过/);
    await assert.rejects(requestCode(db, { email: "nobody@test.com", purpose: "reset" }, { send }), /还没有注册/);
});

test("five wrong codes lock the code", async () => {
    const { requestCode, consumeCode } = await import("../account/verify.js");
    let code = "";
    await requestCode(db, { email: "ivan@test.com", purpose: "register" }, { send: async (_t, c) => { code = c; } });
    const wrong = code === "111111" ? "222222" : "111111";
    for (let i = 0; i < 5; i++) await assert.rejects(consumeCode(db, { email: "ivan@test.com", purpose: "register", code: wrong }));
    await assert.rejects(consumeCode(db, { email: "ivan@test.com", purpose: "register", code }), /错误次数过多/);
});

test("forgot password: reset with an email code and sign in", async () => {
    let res = await call("/send-code", { method: "POST", body: { email: "alice@test.com", purpose: "reset" } });
    const { devCode } = await res.json();
    res = await call("/password/reset", { method: "POST", body: { email: "alice@test.com", code: devCode, password: "newpassword9" } });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).user.email, "alice@test.com");
    await assert.rejects(login(db, { email: "alice@test.com", password: "password123" }), /不正确/);
    const ok = await login(db, { email: "alice@test.com", password: "newpassword9" });
    assert.equal(ok.user.emailVerified, true);
});

test("mail is sent through Resend when configured", async () => {
    const { sendCodeEmail } = await import("../account/mailer.js");
    process.env.RESEND_API_KEY = "re_test";
    process.env.LW_MAIL_FROM = "老屋作坊 <no-reply@vinsen.top>";
    try {
        let captured;
        await sendCodeEmail("x@test.com", "123456", "register", {
            fetchImpl: async (url, init) => { captured = { url, init }; return new Response("{}", { status: 200 }); },
        });
        assert.equal(captured.url, "https://api.resend.com/emails");
        const payload = JSON.parse(captured.init.body);
        assert.deepEqual(payload.to, ["x@test.com"]);
        assert.match(payload.subject, /123456/);
        assert.equal(captured.init.headers.Authorization, "Bearer re_test");
        await assert.rejects(sendCodeEmail("x@test.com", "1", "register", { fetchImpl: async () => new Response("bad", { status: 403 }) }), /发送失败/);
    } finally {
        delete process.env.RESEND_API_KEY;
        delete process.env.LW_MAIL_FROM;
    }
});

test("土豆 key for signed-in users, saved keys only for the admin, direct charge and refund", async () => {
    const { saveChannel, savePrice } = await import("../account/channels.js");
    await saveChannel(db, { id: "tudou", apiKey: "sk-tudou-eye-123456" });
    await savePrice(db, { channel: "tudou", model: "gemini-3-pro-image-preview", spec: "1k", price: "0.4" });
    const bossCookie = cookieOf(await call("/login", { method: "POST", body: { email: "boss@test.com", password: "password123" } }));
    const eye = await register(db, { email: "eye-user@test.com", password: "password123" });
    const userCookie = cookieOf(await call("/login", { method: "POST", body: { email: "eye-user@test.com", password: "password123" } }));

    // The eye on the admin page: saved keys, admin only.
    assert.equal((await (await call("/admin/secret?item=channel:tudou:apiKey", { cookie: bossCookie })).json()).value, "sk-tudou-eye-123456");
    assert.equal((await call("/admin/secret?item=nope", { cookie: bossCookie })).status, 400);
    assert.equal((await call("/admin/secret?item=channel:tudou:apiKey", { cookie: userCookie })).status, 403);

    // 土豆 is called from the browser: signed-in users get its key and see its prices.
    assert.equal((await (await call("/tudou-key", { cookie: userCookie })).json()).apiKey, "sk-tudou-eye-123456");
    assert.equal((await call("/tudou-key")).status, 401);
    const prices = (await (await call("/prices", { cookie: userCookie })).json()).items;
    assert.ok(prices.some((p) => p.channel === "tudou"));

    // Charged before the browser sends the generation; refunded once when it fails.
    const url = "https://api.ai-tudou.net/v1beta/models/gemini-3-pro-image-preview:streamGenerateContent?alt=sse";
    const body = { contents: [{ parts: [{ text: "cat" }] }], generationConfig: { imageConfig: { imageSize: "1K" } } };
    let res = await call("/direct/charge", { method: "POST", cookie: userCookie, body: { url, body } });
    assert.equal(res.status, 402, "no balance yet");
    await adjustBalance(db, eye.id, 1000, { kind: "admin" });
    res = await call("/direct/charge", { method: "POST", cookie: userCookie, body: { url, body } });
    const { ref, amount } = await res.json();
    assert.match(ref, /^direct:[a-f0-9]{12}$/);
    assert.equal(amount, 0.4);
    assert.equal((await userFromSession(db, userCookie.split("=")[1])).balanceMilli, 600);
    assert.equal((await (await call("/direct/refund", { method: "POST", cookie: userCookie, body: { ref, reason: "生成失败" } })).json()).refunded, 0.4);
    assert.equal((await (await call("/direct/refund", { method: "POST", cookie: userCookie, body: { ref } })).json()).refunded, 0, "only once");
    assert.equal((await userFromSession(db, userCookie.split("=")[1])).balanceMilli, 1000);
    // Someone else's charge cannot be refunded, other channels cannot go direct, the admin is free.
    assert.equal((await call("/direct/refund", { method: "POST", cookie: bossCookie, body: { ref } })).status, 404);
    assert.equal((await call("/direct/charge", { method: "POST", cookie: userCookie, body: { url: "https://api.apimart.ai/v1/images/generations", body: {} } })).status, 400);
    assert.deepEqual(await (await call("/direct/charge", { method: "POST", cookie: bossCookie, body: { url, body } })).json(), { ref: "", amount: 0 });
});
