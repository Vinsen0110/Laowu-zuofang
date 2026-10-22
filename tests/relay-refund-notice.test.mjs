import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { userErrorMessage } from "../account/relay.js";

test("gateway timeouts read as a short busy message that says the money came back", () => {
    const cloudflare = '{"type":"https://api.ai-tudou.net/x","status":524,"detail":"The origin web server did not return a complete response"}';
    assert.equal(userErrorMessage(524, cloudflare, 120), "平台繁忙或超时（524），请稍后重试。本次费用 0.12 已退回余额");
    assert.equal(userErrorMessage(504, "Gateway Timeout", 0), "平台繁忙或超时（504），请稍后重试");
});

test("ordinary errors keep their scrubbed text", () => {
    assert.equal(userErrorMessage(400, "bad size from ai-tudou", 80), "bad size from 渠道 1。本次费用 0.08 已退回余额");
    assert.equal(userErrorMessage(400, "", 0), "生成失败（400）");
});

test("the page turns x-lw-refund into a refund notice and the badge ignores pop-ups", async () => {
    const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
    const ui = await readFile(new URL("../account-ui.js", import.meta.url), "utf8");
    assert.equal((html.match(/reportRefund\(/g) || []).length, 3);
    assert.match(ui, /window\.addEventListener\("lw-refunded"/);
    assert.match(ui, /\[data-notification-index\]/);
});
