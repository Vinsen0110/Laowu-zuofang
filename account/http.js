// HTTP routes for /api/account/*. Uses web-standard Request/Response so the
// same code runs on Vercel and in the local preview server.

import { USD_TO_CNY, priceCatalog } from "./catalog.js";
import { channelBalances, deletePrice, getCloudinary, getMailSettings, listChannels, listPrices, saveChannel, saveCloudinary, saveMailSettings, savePrice, savePrices } from "./channels.js";
import { setResendKey } from "./mailer.js";
import { getDatabase } from "./db.js";
import { checkLowBalances } from "./alerts.js";
import { relay } from "./relay.js";
import { verifyImageToken } from "./mask.js";
import { copyResultToCos, cosReady, getCos, publicCos, saveCos, testCos } from "./cos.js";
import { consumeCode, markVerified, requestCode, resetPassword } from "./verify.js";
import {
    AccountError,
    SESSION_DAYS,
    adjustBalance,
    checkPassword,
    normalizeEmail,
    changePassword,
    createCodes,
    deleteCode,
    deleteUser,
    ledger,
    listCodes,
    listUsers,
    login,
    logout,
    redeemCode,
    register,
    renumberUsers,
    setDisplayName,
    issueDeviceToken,
    deviceLogin,
    forgetDevice,
    setAvatar,
    setUserDisabled,
    stats,
    userFromSession,
    yuanToMilli,
} from "./service.js";

const COOKIE = "lw_session";
let mailKeyLoaded = false;

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
        if (!mailKeyLoaded && !injectedDb) {
            mailKeyLoaded = true;
            setResendKey((await getMailSettings(db)).key);
        }
        const token = readCookie(request, COOKIE);

        // ---- daily cron (vercel.json): supplier balance alerts ----
        if (path === "/cron/balances" && method === "GET") {
            return json(200, await checkLowBalances(db, { minIntervalMs: 0 }));
        }

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
            return json(200, { user, deviceToken: await issueDeviceToken(db, user.id) }, { "Set-Cookie": sessionCookie(request, newToken, SESSION_DAYS * 86400) });
        }
        if (path === "/login" && method === "POST") {
            const { token: newToken, user } = await login(db, await body(request));
            return json(200, { user, deviceToken: await issueDeviceToken(db, user.id) }, { "Set-Cookie": sessionCookie(request, newToken, SESSION_DAYS * 86400) });
        }
        if (path === "/device-login" && method === "POST") {
            const { token: newToken, user, deviceToken } = await deviceLogin(db, (await body(request)).deviceToken);
            return json(200, { user, deviceToken }, { "Set-Cookie": sessionCookie(request, newToken, SESSION_DAYS * 86400) });
        }
        if (path === "/device-forget" && method === "POST") {
            await forgetDevice(db, (await body(request)).deviceToken);
            return json(200, { ok: true });
        }
        if (path === "/password/reset" && method === "POST") {
            const input = await body(request);
            const email = await resetPassword(db, input);
            const { token: newToken, user } = await login(db, { email, password: input.password });
            return json(200, { user, deviceToken: await issueDeviceToken(db, user.id) }, { "Set-Cookie": sessionCookie(request, newToken, SESSION_DAYS * 86400) });
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
        if (path === "/img" && method === "GET") {
            // Result images for users, fetched here so the supplier never shows in the browser.
            const target = verifyImageToken(url.searchParams.get("t"));
            if (!target) throw new AccountError(404, "not_found", "图片不存在");
            // Mainland users fetch the copy in the COS bucket, which is far faster for
            // them than this Hong Kong server. Same bytes, no re-encoding.
            const cos = await getCos(db).catch(() => null);
            if (cosReady(cos)) {
                try {
                    const copy = await copyResultToCos(cos, target, { signal: request.signal });
                    if (copy) return new Response(null, { status: 302, headers: { Location: copy, "Cache-Control": "private, max-age=86400" } });
                } catch (error) {
                    if (request.signal?.aborted) throw error;
                    console.error("COS copy failed, serving from this server:", error.message);
                }
            }
            const upstream = await fetch(target, { redirect: "follow", signal: request.signal });
            if (!upstream.ok || !upstream.body) throw new AccountError(502, "img_failed", "图片加载失败");
            return new Response(upstream.body, {
                status: 200,
                headers: {
                    "Content-Type": upstream.headers.get("content-type") || "application/octet-stream",
                    "Cache-Control": "private, max-age=86400",
                },
            });
        }

        if (path === "/profile" && method === "POST") {
            const { displayName } = await body(request);
            return json(200, { user: await setDisplayName(db, me.id, displayName) });
        }
        if (path === "/avatar" && method === "POST") {
            const { avatar } = await body(request);
            return json(200, { user: await setAvatar(db, me.id, avatar) });
        }
        if (path === "/prices" && method === "GET") {
            // Selling prices only (no costs), for the canvas to show before generating.
            const items = (await listPrices(db)).filter((p) => p.enabled).map(({ channel, model, spec, price }) => ({ channel, model, spec, price }));
            return json(200, { items });
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
            if (path === "/admin/renumber-users" && method === "POST") {
                return json(200, await renumberUsers(db));
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
            if (path === "/admin/delete-code" && method === "POST") {
                await deleteCode(db, (await body(request)).code);
                return json(200, { ok: true });
            }
            if (path === "/admin/channels" && method === "GET") {
                return json(200, { items: await listChannels(db) });
            }
            if (path === "/admin/channels" && method === "POST") {
                return json(200, { channel: await saveChannel(db, await body(request)) });
            }
            if (path === "/admin/channel-balances" && method === "GET") {
                const id = url.searchParams.get("id");
                return json(200, await channelBalances(db, id ? { ids: [id] } : {}));
            }
            if (path === "/admin/prices" && method === "GET") {
                return json(200, { items: await listPrices(db) });
            }
            if (path === "/admin/prices" && method === "POST") {
                return json(200, { price: await savePrice(db, await body(request)) });
            }
            if (path === "/admin/mail" && method === "GET") {
                const { key, ...rest } = await getMailSettings(db);
                return json(200, rest);
            }
            if (path === "/admin/mail" && method === "POST") {
                const saved = await saveMailSettings(db, await body(request));
                setResendKey(saved.key);
                const { key, ...rest } = saved;
                return json(200, rest);
            }
            if (path === "/admin/cos" && method === "GET") {
                return json(200, publicCos(await getCos(db)));
            }
            if (path === "/admin/cos" && method === "POST") {
                return json(200, publicCos(await saveCos(db, await body(request))));
            }
            if (path === "/admin/cos/test" && method === "POST") {
                return json(200, await testCos(await getCos(db)));
            }
            if (path === "/admin/cloudinary" && method === "GET") {
                return json(200, await getCloudinary(db));
            }
            if (path === "/admin/cloudinary" && method === "POST") {
                return json(200, await saveCloudinary(db, await body(request)));
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
            // x-lw-code lets the page react to e.g. "insufficient" whatever the provider client shows.
            return json(error.status, { error: { code: error.code, message: error.message } }, { "x-lw-code": error.code });
        }
        console.error("Account API error:", error);
        return json(500, { error: { code: "server_error", message: "服务器出错了，请稍后再试" } });
    }
}
