import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
    SITE_DISPLAY_ORDER,
    orderModelReferences,
    orderRatioPresets,
    orderSiteChannels,
    siteVisible,
} from "../display-order.js";

const bundle = await readFile(new URL("../assets/index-B2KJ37fm.js", import.meta.url), "utf8");
// The admin sees every site; 土豆 is hidden from users (see the last test).
globalThis.__lwIsAdmin = true;

test("site displays known providers first without mutating stored channels", () => {
    const channels = [
        { id: "custom", name: "Custom" },
        { id: "tudou", name: "Tudou" },
        { id: "runninghub", name: "RH" },
        { id: "grsai", name: "Grsai" },
        { id: "apimart", name: "Mart" },
    ];

    // 渠道 1-4: Tudou, Mart, RH, Grsai (sites with their own upload first)
    assert.deepEqual(SITE_DISPLAY_ORDER, ["tudou", "apimart", "runninghub", "grsai"]);
    assert.deepEqual(orderSiteChannels(channels).map(({ name }) => name), ["Tudou", "Mart", "RH", "Grsai", "Custom"]);
    assert.deepEqual(channels.map(({ name }) => name), ["Custom", "Tudou", "RH", "Grsai", "Mart"]);
    assert.deepEqual(
        orderModelReferences([
            "tudou::gpt-image-2",
            "default::nano-banana-pro",
            "runninghub::gpt-image-2",
            "runninghub::nano-banana-pro",
            "apimart::nano-banana-pro",
            "grsai::nano-banana-pro",
        ]),
        [
            "tudou::gpt-image-2",
            "apimart::nano-banana-pro",
            "runninghub::gpt-image-2",
            "runninghub::nano-banana-pro",
            "grsai::nano-banana-pro",
            "default::nano-banana-pro",
        ],
    );
});

test("ratio displays keep Auto first and sort by numerator then denominator", () => {
    const values = ["auto", "1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9", "2:1", "1:2", "3:1", "1:3", "9:21"];
    assert.deepEqual(
        orderRatioPresets(values.map((value) => ({ value }))).map(({ value }) => value),
        ["auto", "1:1", "1:2", "1:3", "2:1", "2:3", "3:1", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "9:21", "16:9", "21:9"],
    );
});

test("Mart 2.1 stays beside the existing Mart model without reordering other providers", () => {
    const references = [
        "runninghub::nano-banana-pro",
        "apimart::nano-banana-2.1",
        "tudou::nano-banana-pro",
        "apimart::nano-banana-pro",
        "grsai::nano-banana-pro",
    ];
    assert.deepEqual(orderModelReferences(references), [
        "tudou::nano-banana-pro",
        "apimart::nano-banana-2.1",
        "apimart::nano-banana-pro",
        "runninghub::nano-banana-pro",
        "grsai::nano-banana-pro",
    ]);
    assert.equal(references[0], "runninghub::nano-banana-pro");
});

test("all site and ratio selectors use the shared display order", () => {
    assert.match(bundle, /from"\.\.\/display-order\.js(?:\?v=[^"]+)?"/);
    assert.match(bundle, /orderSiteChannels\(a\.channels\)\.map/);
    assert.match(bundle, /orderSiteChannels\(siteConfig\.channels\|\|\[\]\)\.map/);
    assert.match(bundle, /orderModelReferences\(Array\.from\(new Set/);
    assert.match(bundle, /orderModelReferences\(CS\(e,"image"\)\.filter\(mke\)\)/);
    assert.match(bundle, /ratioPresets=orderRatioPresets\(isGptImageModel\?/);
    assert.match(bundle, /items:orderRatioPresets\(v\?/);
});

test("users see numbered channels, admins see provider names", async () => {
    const { siteDisplayName, siteDisplayNote } = await import("../display-order.js");
    globalThis.__lwIsAdmin = false;
    assert.equal(siteDisplayName({ id: "runninghub", name: "RH" }), "渠道 3");
    assert.equal(siteDisplayName({ id: "tudou", name: "Tudou" }), "渠道 1");
    assert.equal(siteDisplayNote({ id: "runninghub" }), "最稳定 · 价格较高");
    globalThis.__lwIsAdmin = true;
    assert.equal(siteDisplayName({ id: "runninghub", name: "RH" }), "RH");
    delete globalThis.__lwIsAdmin;
});

test("users see every site, 土豆 included", () => {
    globalThis.__lwIsAdmin = false;
    try {
        const channels = [{ id: "tudou", name: "Tudou" }, { id: "runninghub", name: "RH" }, { id: "grsai", name: "Grsai" }];
        assert.deepEqual(orderSiteChannels(channels).map(({ id }) => id), ["tudou", "runninghub", "grsai"]);
        assert.deepEqual(orderModelReferences(["runninghub::nano-banana-pro", "tudou::nano-banana-pro"]), ["tudou::nano-banana-pro", "runninghub::nano-banana-pro"]);
    } finally {
        globalThis.__lwIsAdmin = true;
    }
});

test("a channel switched off on the admin page is hidden for everyone, the admin too", () => {
    const channels = [{ id: "tudou", name: "Tudou" }, { id: "runninghub", name: "RH" }, { id: "grsai", name: "Grsai" }];
    globalThis.__lwDisabledSites = new Set(["grsai"]);
    try {
        for (const admin of [true, false]) {
            globalThis.__lwIsAdmin = admin;
            assert.equal(siteVisible("grsai"), false);
            assert.deepEqual(orderSiteChannels(channels).map(({ id }) => id), ["tudou", "runninghub"]);
            assert.deepEqual(orderModelReferences(["grsai::nano-banana-pro", "tudou::nano-banana-pro"]), ["tudou::nano-banana-pro"]);
        }
    } finally {
        globalThis.__lwDisabledSites = undefined;
        globalThis.__lwIsAdmin = true;
    }
    assert.equal(siteVisible("grsai"), true);
});
