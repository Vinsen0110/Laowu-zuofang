import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { openMemoryDatabase } from "../account/db.js";
import { AVATAR_MAX_CHARS, register, setAvatar } from "../account/service.js";

const db = await openMemoryDatabase();
test.after(() => db.close());
const { user } = await register(db, { email: "pic@test.com", password: "password123" }).then((r) => ({ user: r.user ?? r }));

test("users can save a small PNG/JPEG/WebP avatar and go back to the generated one", async () => {
    const png = "data:image/png;base64,iVBORw0KGgo=";
    assert.equal((await setAvatar(db, user.id, png)).avatar, png);
    assert.equal((await setAvatar(db, user.id, "")).avatar, "");
});

test("other formats, scripts and oversized pictures are refused", async () => {
    for (const bad of ["data:image/svg+xml;base64,PHN2Zz4=", "javascript:alert(1)", "https://x.test/a.png",
        "data:image/png;base64," + "A".repeat(AVATAR_MAX_CHARS)]) {
        await assert.rejects(setAvatar(db, user.id, bad), /头像图片/);
    }
});

test("generated avatars are stable per email and differ between people", async () => {
    const ctx = { globalThis: {}, encodeURIComponent };
    ctx.globalThis = ctx;
    vm.runInNewContext(await readFile(new URL("../avatar.js", import.meta.url), "utf8"), ctx);
    const a = ctx.lwAvatarUrl({ email: "a@qq.com" });
    assert.equal(a, ctx.lwAvatarUrl({ email: "A@qq.com" }));
    assert.notEqual(a, ctx.lwAvatarUrl({ email: "b@qq.com" }));
    assert.match(a, /^data:image\/svg\+xml/);
    assert.equal(ctx.lwAvatarUrl({ email: "a@qq.com", avatar: "data:image/png;base64,AA==" }), "data:image/png;base64,AA==");
});
