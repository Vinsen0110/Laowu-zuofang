// HTTP routes for /api/account/*. Uses web-standard Request/Response so the
// same code runs on Vercel and in the local preview server.

import { USD_TO_CNY, priceCatalog } from "./catalog.js";
import { channelBalances, deletePrice, listChannels, listPrices, saveChannel, savePrice, savePrices } from "./channels.js";
import { getDatabase } from "./db.js";
import { relay } from "./relay.js";
import { consumeCode, markVerified, requestCode, resetPassword } from "./verify.js";
import {
    AccountError,
    SESSION_DAYS,
    adjustBalance,
    checkPassword,
    normalizeEmail,
    changePassword,
    createCodes,
    deleteUser,
    ledger,
    listCodes,
    listUsers,
    login,
    logout,
    redeemCode,
    register,
    setUserDisabled,
    stats,
    userFromSession,
    yuanToMilli,
} from "./service.js";

const COOKIE = "lw_session";

function json(status, body, extraHeaders = {}) {
    return new Response(JSON.stringify(body), {
        status,
        headers: {
            "Cache-Control": "no-store",
            "Content-Type": "application/json; charset=utf-8",
            ...extraHeaders,
        },
    });
}

function readCookie(request, name) {
    const header = request.headers.get("cookie") || "";
    for (const part of header.split(";")) {
        const [k, ...rest] = part.trim().split("=");
        if (k === name) return decodeURIComponent(rest.join("="));
    }
    return null;
}

function sessionCookie(request, token, maxAgeSeconds) {
    const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
    return `${COOKIE}=${token ? encodeURIComponent(token) : ""}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure}`;
}

async function body(request) {
    try {
        const text = await request.text();
        return text ? JSON.parse(text) : {};
    } catch {
        throw new AccountError(400, "bad_json", "请求格式不正确");
    }
}

function sameOrigin(request) {
    const origin = request.headers.get("origin");
    if (!origin) return true;
    try {
        return new URL(origin).host === new URL(request.url).host;
    } catch {
        return false;
    }
}

export async function handleAccountRequest(request, { db: injectedDb } = {}) {
    const url = new URL(request.url);
    // On Vercel the rewrite passes the sub-path as ?path=...; locally it stays in the URL path.
    const rewritten = url.searchParams.get("path");
    url.searchParams.delete("path");
    const path = rewritten != null
        ? `/${rewritten.replace(/^\/+/, "")}`
        : url.pathname.replace(/^\/api\/account/, "") || "/";
    const method = request.method.toUpperCase();

    try {
        if (method !== "GET" && !sameOrigin(request)) {
            throw new AccountError(403, "bad_origin", "请求来源不被允许");
        }
        const db = injectedDb || (await getDatabase());
        const token = readCookie(request, COOKIE);

        // ---- public ----
        if (path === "/send-code" && method === "POST") {
            const { email, purpose } = await body(request);
            const ip = (request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || "").split(",")[0].trim();
            return json(200, await requestCode(db, { email, purpose: purpose === "reset" ? "reset" : "register", ip }));
        }
        if (path === "/register" && method === "POST") {
            const input = await body(request);
            normalizeEmail(input.email);
            checkPassword(input.password);
            const email = await consumeCode(db, { email: input.email, purpose: "register", code: input.code });
            await register(db, { email, password: input.password });
            await markVerified(db, email);
            const { token: newToken, user } = await login(db, { email, password: input.password });
            return json(200, { user }, { "Set-Cookie": sessionCookie(request, newToken, SESSION_DAYS * 86400) });
        }
        if (path === "/login" && method === "POST") {
            const { token: newToken, user } = await login(db, await body(request));
            return json(200, { user }, { "Set-Cookie": sessionCookie(request, newToken, SESSION_DAYS * 86400) });
        }
        if (path === "/password/reset" && method === "POST") {
            const input = await body(request);
            const email = await resetPassword(db, input);
            const { token: newToken, user } = await login(db, { email, password: input.password });
            return json(200, { user }, { "Set-Cookie": sessionCookie(request, newToken, SESSION_DAYS * 86400) });
        }
        if (path === "/logout" && method === "POST") {
            await logout(db, token);
            return json(200, { ok: true }, { "Set-Cookie": sessionCookie(request, "", 0) });
        }

        // ---- signed in ----
        const me = await userFromSession(db, token);
        if (path === "/me" && method === "GET") {
            return json(200, { user: me });
        }
        if (!me) throw new AccountError(401, "not_signed_in", "请先登录");

        if (path === "/relay") {
            return await relay(db, me, request);
        }

        if (path === "/ledger" && method === "GET") {
            return json(200, { items: await ledger(db, me.id, url.searchParams.get("limit")) });
        }
        if (path === "/redeem" && method === "POST") {
            const { code } = await body(request);
            const result = await redeemCode(db, me.id, code);
            return json(200, result);
        }
        if (path === "/password" && method === "POST") {
            await changePassword(db, me.id, await body(request));
            return json(200, { ok: true }, { "Set-Cookie": sessionCookie(request, "", 0) });
        }

        // ---- admin ----
        if (path.startsWith("/admin/")) {
            if (me.role !== "admin") throw new AccountError(403, "forbidden", "没有管理员权限");
            if (path === "/admin/stats" && method === "GET") {
                return json(200, await stats(db));
            }
            if (path === "/admin/users" && method === "GET") {
                return json(200, { items: await listUsers(db, { search: url.searchParams.get("q") || "" }) });
            }
            if (path === "/admin/balance" && method === "POST") {
                const { userId, amountYuan, note } = await body(request);
                const delta = yuanToMilli(amountYuan);
                const balance = await adjustBalance(db, Number(userId), delta, {
                    kind: "admin",
                    note: note || (delta > 0 ? "管理员充值" : "管理员扣减"),
                    ref: `by:${me.username}`,
                });
                if (balance === null) throw new AccountError(400, "insufficient", "扣减后余额会小于 0");
                return json(200, { balance: balance / 1000 });
            }
            if (path === "/admin/user-ledger" && method === "GET") {
                return json(200, { items: await ledger(db, Number(url.searchParams.get("userId")), 100) });
            }
            if (path === "/admin/disable" && method === "POST") {
                const { userId, disabled } = await body(request);
                if (Number(userId) === me.id) throw new AccountError(400, "self", "不能停用自己的账号");
                await setUserDisabled(db, Number(userId), disabled);
                return json(200, { ok: true });
            }
            if (path === "/admin/delete-user" && method === "POST") {
                const { userId } = await body(request);
                if (Number(userId) === me.id) throw new AccountError(400, "self", "不能删除自己的账号");
                await deleteUser(db, Number(userId));
                return json(200, { ok: true });
            }
            if (path === "/admin/codes" && method === "POST") {
                return json(200, await createCodes(db, await body(request)));
            }
            if (path === "/admin/channels" && method === "GET") {
                return json(200, { items: await listChannels(db) });
            }
            if (path === "/admin/channels" && method === "POST") {
                return json(200, { channel: await saveChannel(db, await body(request)) });
            }
            if (path === "/admin/channel-balances" && method === "GET") {
                return json(200, await channelBalances(db));
            }
            if (path === "/admin/prices" && method === "GET") {
                return json(200, { items: await listPrices(db) });
            }
            if (path === "/admin/prices" && method === "POST") {
                return json(200, { price: await savePrice(db, await body(request)) });
            }
            if (path === "/admin/price-catalog" && method === "GET") {
                return json(200, { fx: USD_TO_CNY, rows: priceCatalog(), prices: await listPrices(db) });
            }
            if (path === "/admin/prices/bulk" && method === "POST") {
                const { items } = await body(request);
                return json(200, { items: await savePrices(db, items) });
            }
            if (path === "/admin/prices/delete" && method === "POST") {
                const { id } = await body(request);
                await deletePrice(db, id);
                return json(200, { ok: true });
            }
            if (path === "/admin/codes" && method === "GET") {
                return json(200, { items: await listCodes(db, { batch: url.searchParams.get("batch") || "" }) });
            }
        }

        throw new AccountError(404, "not_found", "接口不存在");
    } catch (error) {
        if (error instanceof AccountError) {
            return json(error.status, { error: { code: error.code, message: error.message } });
        }
        console.error("Account API error:", error);
        return json(500, { error: { code: "server_error", message: "服务器出错了，请稍后再试" } });
    }
}
