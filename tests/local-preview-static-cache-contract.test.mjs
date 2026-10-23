import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const server = await readFile(new URL("../local-preview-server.mjs", import.meta.url), "utf8");

test("static cache: icons and versioned files are immutable, index.html is never cached", () => {
    assert.ok(server.includes('const isIconAsset = pathname === "/icons" || pathname.startsWith("/icons/");'));
    assert.match(server, /const versioned = requestUrl\.searchParams\.has\("v"\) \|\| pathname\.startsWith\("\/assets\/"\);/);
    assert.match(
        server,
        /"Cache-Control": isHtml\s*\?\s*"no-store"\s*:\s*isIconAsset \|\| versioned\s*\?\s*"public, max-age=31536000, immutable"\s*:\s*"public, max-age=300"/,
    );
});

test("account API responses stream and private folders are not served", () => {
    assert.match(server, /await pipeline\(Readable\.fromWeb\(webResponse\.body\), response\);/);
    assert.match(server, /isRelay \? 40 \* 1024 \* 1024 : isReference \? 10_500_000 : 64 \* 1024/);
    assert.match(server, /node_modules\\\/\|tests\\\/\|deploy\\\//);
});
