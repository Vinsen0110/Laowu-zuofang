import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
    SITE_DISPLAY_ORDER,
    orderModelReferences,
    orderRatioPresets,
    orderSiteChannels,
} from "../display-order.js";

const bundle = await readFile(new URL("../assets/index-B2KJ37fm.js", import.meta.url), "utf8");

test("site displays use RH, Mart, Soon, Tudou, Grsai, Apilio order without mutating stored channels", () => {
    const channels = [
        { id: "default", name: "Apilio" },
        { id: "tudou", name: "Tudou" },
        { id: "runninghub", name: "RH" },
        { id: "grsai", name: "Grsai" },
        { id: "apimart", name: "Mart" },
        { id: "soon", name: "Soon" },
    ];

    assert.deepEqual(SITE_DISPLAY_ORDER, ["runninghub", "apimart", "soon", "tudou", "grsai", "default"]);
    assert.deepEqual(orderSiteChannels(channels).map(({ name }) => name), ["RH", "Mart", "Soon", "Tudou", "Grsai", "Apilio"]);
    assert.deepEqual(channels.map(({ name }) => name), ["Apilio", "Tudou", "RH", "Grsai", "Mart", "Soon"]);
    assert.deepEqual(
        orderModelReferences([
            "tudou::gpt-image-2",
            "default::nano-banana-pro",
            "runninghub::gpt-image-2",
            "runninghub::nano-banana-pro",
            "apimart::nano-banana-pro",
            "soon::nano-banana-pro",
            "grsai::nano-banana-pro",
        ]),
        [
            "runninghub::gpt-image-2",
            "runninghub::nano-banana-pro",
            "apimart::nano-banana-pro",
            "soon::nano-banana-pro",
            "tudou::gpt-image-2",
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
        "soon::nano-banana-pro",
        "apimart::nano-banana-2.1",
        "tudou::nano-banana-pro",
        "apimart::nano-banana-pro",
        "grsai::nano-banana-pro",
    ];
    assert.deepEqual(orderModelReferences(references), [
        "apimart::nano-banana-2.1",
        "apimart::nano-banana-pro",
        "soon::nano-banana-pro",
        "tudou::nano-banana-pro",
        "grsai::nano-banana-pro",
    ]);
    assert.equal(references[0], "soon::nano-banana-pro");
});

test("all site and ratio selectors use the shared display order", () => {
    assert.match(bundle, /from"\.\.\/display-order\.js(?:\?v=[^"]+)?"/);
    assert.match(bundle, /orderSiteChannels\(a\.channels\)\.map/);
    assert.match(bundle, /orderSiteChannels\(siteConfig\.channels\|\|\[\]\)\.map/);
    assert.match(bundle, /orderModelReferences\(Array\.from\(new Set/);
    assert.match(bundle, /orderModelReferences\(CS\(e,"image"\)\.filter\(mke\)\)/);
    assert.match(bundle, /options:orderRatioPresets\(isRunningHubGpt25\?runningHub25RatioOptions\(\{\.\.\.a,model:a\.imageModel\|\|a\.model\},\[\.\.\.J2e,\.\.\.GPT_IMAGE_EXTRA_RATIO_PRESETS\]\):isGptImageConfig\?/);
    assert.match(bundle, /ratioPresets=orderRatioPresets\(isRunningHub25\?runningHub25RatioOptions\(e,\[\.\.\.pg,\.\.\.GPT_IMAGE_EXTRA_RATIO_PRESETS\]\):isGptImageModel\?/);
    assert.match(bundle, /items:orderRatioPresets\(isRunningHub25\?runningHub25RatioOptions\(t,\[\.\.\.pX,\.\.\.GPT_IMAGE_EXTRA_RATIO_PRESETS\]\):v\?/);
});
