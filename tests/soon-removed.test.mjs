// Soon (渠道 5) was removed from the canvas, the price table and the admin page.
// These checks keep it from coming back by accident.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

import { CHANNELS, listChannels, listPrices, savePrice } from "../account/channels.js";
import { priceCatalog } from "../account/catalog.js";
import { openMemoryDatabase } from "../account/db.js";
import { CHANNEL_LABELS, scrubText } from "../account/mask.js";
import { channelForUrl } from "../account/relay.js";
import { SITE_CHANNEL_LABELS, SITE_DISPLAY_ORDER } from "../display-order.js";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("no running file mentions Soon or its hosts", async () => {
    assert.equal(existsSync(new URL("soon-api.js", root)), false, "soon-api.js is deleted");
    const files = [
        "assets/index-B2KJ37fm.js", "index.html", "admin.html", "theme.css",
        "account-ui.js", "account-pricing.js", "canvas-price-table.js", "display-order.js",
        "account/relay.js", "account/channels.js", "account/catalog.js", "account/mask.js",
        "account/alerts.js", "account/cos.js", "deploy/seed-prices.mjs",
    ];
    for (const file of files) {
        // Plain English "as soon as" in a comment is fine; the supplier is not.
        const text = (await read(file)).replace(/as soon as/gi, "")
            // The one intended leftover: users whose saved site was Soon are moved to 渠道 1.
            .replace('a.activeSiteId==="soon"?TUDOU_SITE_ID', "")
            .replace('||ref.channelId==="soon"', "");
        assert.doesNotMatch(text, /soonstudio|SOON_|soon-api|runSoon|soonImage|soonReference|soonBalance|lw-site-soon|provider-soon/i, file);
        assert.doesNotMatch(text, /["'`]soon["'`]|\bsoon:|\bSoon\b/, file);
    }
});

test("server and admin only know the four remaining channels", async () => {
    assert.deepEqual(CHANNELS.map((c) => c.id), ["tudou", "apimart", "grsai", "runninghub"]);
    assert.deepEqual(SITE_DISPLAY_ORDER, ["tudou", "apimart", "grsai", "runninghub"]);
    assert.deepEqual(CHANNEL_LABELS, { tudou: "渠道 1", apimart: "渠道 2", grsai: "渠道 3", runninghub: "渠道 4" });
    assert.deepEqual(SITE_CHANNEL_LABELS, CHANNEL_LABELS);
    assert.equal(priceCatalog().some((r) => r.channel === "soon"), false, "no Soon rows in the admin price catalog");
    for (const host of ["api.soonstudio.ai", "api-hk.soonstudio.ai", "api-us.soonstudio.ai"]) {
        assert.throws(() => channelForUrl(`https://${host}/v1beta/models/x:generateContent`), /不支持/);
    }
    assert.equal(scrubText("渠道 1 失败"), "渠道 1 失败");
});

test("Soon data already in the database stays stored but is hidden from the admin page and canvas", async () => {
    const db = await openMemoryDatabase();
    try {
        await db.query("INSERT INTO lw_channels (id, api_key) VALUES ('soon', 'sk-old-soon')");
        await db.query("INSERT INTO lw_prices (channel, model, spec, price_milli) VALUES ('soon', 'gemini-3-pro-image', '4k', 600)");
        await savePrice(db, { channel: "tudou", model: "gemini-3-pro-image-preview", spec: "4k", price: "0.45" });

        assert.equal((await listChannels(db)).some((c) => c.id === "soon"), false, "admin channel list");
        const prices = await listPrices(db);
        assert.equal(prices.some((p) => p.channel === "soon"), false, "admin + canvas price list");
        assert.equal(prices.length, 1);
        // Still in the database for the record.
        assert.equal((await db.query("SELECT COUNT(*) AS n FROM lw_prices WHERE channel = 'soon'"))[0].n, 1);
        await assert.rejects(savePrice(db, { channel: "soon", model: "x", price: "1" }), /未知的渠道/);
    } finally {
        await db.close();
    }
});

test("admin page lists no Soon section and no Soon wording", async () => {
    const admin = await read("admin.html");
    assert.match(admin, /const COLS = \["tudou", "apimart", "grsai", "runninghub"\];/);
    assert.match(admin, /RH、Grsai、APIMart 的结果图从广州存储下载/);
    assert.match(admin, /RH、Grsai、APIMart 的结果图由浏览器直接从平台下载/);
});

test("a user whose saved site was Soon lands on 渠道 1 (土豆), not the RH fallback", async () => {
    const bundle = await read("assets/index-B2KJ37fm.js");
    const marker = "d=l.some(w=>w.id===a.activeSiteId)?a.activeSiteId:";
    const at = bundle.indexOf(marker);
    assert.ok(at > 0, "saved-settings merge picks the active site");
    const expr = bundle.slice(at + 2, bundle.indexOf(",f=l.find(", at));
    assert.equal(expr, 'l.some(w=>w.id===a.activeSiteId)?a.activeSiteId:a.activeSiteId==="soon"?TUDOU_SITE_ID:DP');
    const pick = (saved) => vm.runInNewContext(expr, {
        l: [{ id: "tudou" }, { id: "apimart" }, { id: "grsai" }, { id: "runninghub" }],
        a: { activeSiteId: saved },
        TUDOU_SITE_ID: "tudou",
        DP: "runninghub",
    });
    assert.equal(pick("soon"), "tudou");
    assert.equal(pick("apimart"), "apimart");
    assert.equal(pick("something-else"), "runninghub");
});

test("the canvas loads the new module versions so browsers drop the old Soon code", async () => {
    const html = await read("index.html");
    const bundle = await read("assets/index-B2KJ37fm.js");
    const versions = [...html.matchAll(/\.\/assets\/index-B2KJ37fm\.js\?v=([^"]+)"/g)].map((m) => m[1]);
    assert.equal(versions.length, 2);
    assert.equal(versions[0], versions[1]);
    assert.notEqual(versions[0], "20261029-dropreplace-03");
    assert.doesNotMatch(bundle, /display-order\.js\?v=20261026-tudoudirect-01/);
    assert.doesNotMatch(bundle, /account-pricing\.js\?v=20261023-proratio-01/);
    assert.doesNotMatch(html, /canvas-price-table\.js\?v=20261022-mart-01|account-ui\.js\?v=20261026-imgsave-01|theme\.css\?v=20261022-sitemenu-01/);
});
