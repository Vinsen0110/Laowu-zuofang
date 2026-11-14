// Every place that lists the channels must agree with display-order.js.
// Adding, removing or renumbering a channel? Follow docs/新增站点和模型清单.md;
// this test names the file that was missed.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { SITE_CHANNEL_LABELS, SITE_CHANNEL_NOTES, SITE_DISPLAY_ORDER } from "../display-order.js";
import { CHANNELS, CHANNEL_LABELS as SERVER_LABELS } from "../account/channels.js";
import { CHANNEL_LABELS as MASK_LABELS, scrubText } from "../account/mask.js";
import { channelForUrl } from "../account/relay.js";
import { APIMART_ORIGIN, APIMART_SITE_ID } from "../apimart-api.js";
import { GRSAI_ORIGIN, GRSAI_SITE_ID } from "../grsai-api.js";
import { RUNNINGHUB_LLM_ORIGIN, RUNNINGHUB_ORIGIN, RUNNINGHUB_SITE_ID } from "../runninghub-api.js";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [adminHtml, indexHtml, themeCss, priceTable, accountUi, alerts, sweeper, seedPrices, bundle] = await Promise.all([
    read("admin.html"), read("index.html"), read("theme.css"), read("canvas-price-table.js"), read("account-ui.js"),
    read("account/alerts.js"), read("account/task-sweeper.js"), read("deploy/seed-prices.mjs"), read("assets/index-B2KJ37fm.js"),
]);

const IDS = SITE_DISPLAY_ORDER;

// The upstream addresses of each channel. A new channel adds its line here.
const ORIGINS = {
    tudou: ["https://api.ai-tudou.net"],
    apimart: [APIMART_ORIGIN],
    grsai: [GRSAI_ORIGIN],
    runninghub: [RUNNINGHUB_ORIGIN, RUNNINGHUB_LLM_ORIGIN],
};

// Pulls `name = [ ... ]` or `name = { ... }` (one line, maybe after `x ||`) out of a source file and evaluates it.
function literal(source, name, file) {
    const match = source.match(new RegExp(`\\b${name}\\s*=\\s*(?:\\w+\\s*\\|\\|\\s*)?(\\[[^\\]\\n]*\\]|\\{[^}\\n]*\\})`));
    assert.ok(match, `${file}：找不到 ${name}`);
    return Function(`"use strict"; return (${match[1]});`)();
}

function sameKeys(object, file) {
    assert.deepEqual(Object.keys(object).sort(), [...IDS].sort(), `${file} 的渠道和 display-order.js 不一致`);
}

test("display-order.js numbers the channels 渠道 1..N in display order", () => {
    assert.deepEqual(Object.keys(SITE_CHANNEL_LABELS), IDS);
    IDS.forEach((id, index) => assert.equal(SITE_CHANNEL_LABELS[id], `渠道 ${index + 1}`, id));
    sameKeys(SITE_CHANNEL_NOTES, "display-order.js SITE_CHANNEL_NOTES");
    sameKeys(ORIGINS, "本测试的 ORIGINS");
});

test("server channel list and labels match display-order.js", () => {
    assert.deepEqual(CHANNELS.map((channel) => channel.id), IDS, "account/channels.js CHANNELS");
    assert.deepEqual(SERVER_LABELS, SITE_CHANNEL_LABELS, "account/channels.js CHANNEL_LABELS");
    assert.deepEqual(MASK_LABELS, SITE_CHANNEL_LABELS, "account/mask.js CHANNEL_LABELS");
    assert.deepEqual(literal(alerts, "wanted", "account/alerts.js").slice().sort(), [...IDS].sort(), "account/alerts.js 余额提醒");
});

test("admin page columns and names match display-order.js", () => {
    assert.deepEqual(literal(adminHtml, "COLS", "admin.html"), IDS, "admin.html COLS");
    assert.deepEqual(literal(adminHtml, "CHANNEL_NAME", "admin.html"), SITE_CHANNEL_LABELS, "admin.html CHANNEL_NAME");
});

test("canvas price table order, names and notes match display-order.js", () => {
    assert.deepEqual(literal(priceTable, "order", "canvas-price-table.js"), IDS, "canvas-price-table.js order");
    assert.deepEqual(literal(priceTable, "notes", "canvas-price-table.js"), SITE_CHANNEL_NOTES, "canvas-price-table.js notes");
    sameKeys(literal(priceTable, "providerClass", "canvas-price-table.js"), "canvas-price-table.js providerClass");
    const names = priceTable.match(/const names = isAdmin\s*\?\s*(\{[^}]*\})\s*:\s*(\{[^}]*\})/);
    assert.ok(names, "canvas-price-table.js：找不到 names");
    sameKeys(Function(`return (${names[1]})`)(), "canvas-price-table.js 管理员 names");
    assert.deepEqual(Function(`return (${names[2]})`)(), SITE_CHANNEL_LABELS, "canvas-price-table.js 用户 names");
});

test("account-ui knows every channel's short name and balance host", () => {
    sameKeys(literal(accountUi, "SITE_SHORT", "account-ui.js"), "account-ui.js SITE_SHORT");
    for (const id of IDS) {
        assert.ok(accountUi.includes(`, "${id}"]`), `account-ui.js SITE_BY_HOST 缺少 ${id}`);
    }
});

test("every channel's address is recognised by the relay and the balance hooks", () => {
    const balanceHost = indexHtml.match(/var balanceHost = (\/.*\/);/);
    assert.ok(balanceHost, "index.html：找不到 balanceHost");
    const indexBalanceHost = Function(`return ${balanceHost[1]}`)();
    for (const [id, origins] of Object.entries(ORIGINS)) {
        for (const origin of origins) {
            assert.equal(channelForUrl(`${origin}/v1/x`).channel, id, `account/relay.js HOSTS 没认出 ${origin}`);
            assert.ok(indexBalanceHost.test(new URL(origin).hostname), `index.html balanceHost 没认出 ${origin}`);
        }
    }
});

test("users never see a channel's real name or address in error text", () => {
    for (const channel of CHANNELS) {
        const text = `${channel.name} 出错：${ORIGINS[channel.id][0]}/v1/x`;
        const scrubbed = scrubText(text);
        assert.ok(!scrubbed.toLowerCase().includes(channel.name.toLowerCase()), `account/mask.js 没隐藏 ${channel.name}：${scrubbed}`);
        assert.ok(scrubbed.includes(SITE_CHANNEL_LABELS[channel.id]), `account/mask.js 没换成 ${SITE_CHANNEL_LABELS[channel.id]}`);
    }
});

test("stuck tasks of every channel can be settled and refunded", () => {
    const block = sweeper.match(/const STATUS_REQUEST = \{([\s\S]*?)\n\};/);
    assert.ok(block, "account/task-sweeper.js：找不到 STATUS_REQUEST");
    const ids = [...block[1].matchAll(/^\s+(\w+):/gm)].map((m) => m[1]);
    assert.deepEqual(ids.sort(), [...IDS].sort(), "account/task-sweeper.js STATUS_REQUEST");
});

test("starting prices, site colours and the canvas cover every channel", () => {
    const plan = seedPrices.match(/const plan = \{([\s\S]*?)\n\};/);
    assert.ok(plan, "deploy/seed-prices.mjs：找不到 plan");
    const planIds = [...plan[1].matchAll(/^ {4}(\w+): \{/gm)].map((m) => m[1]);
    assert.deepEqual(planIds.sort(), [...IDS].sort(), "deploy/seed-prices.mjs plan");
    for (const id of IDS) {
        assert.ok(themeCss.includes(`--lw-site-${id}:`), `theme.css 缺少 --lw-site-${id}`);
        assert.ok(indexHtml.includes(`[data-site="${id}"]`), `index.html 缺少 [data-site="${id}"] 站点色`);
        assert.ok(bundle.includes(`provider==="${id}"`), `打包文件没识别 provider ${id}`);
    }
    assert.deepEqual([APIMART_SITE_ID, GRSAI_SITE_ID, RUNNINGHUB_SITE_ID].sort(), IDS.filter((id) => id !== "tudou").sort());
});
