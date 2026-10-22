import assert from "node:assert/strict";
import test from "node:test";
import { openMemoryDatabase } from "../account/db.js";
import { changePassword, deviceLogin, forgetDevice, issueDeviceToken, login, register, setUserDisabled } from "../account/service.js";

const db = await openMemoryDatabase();
test.after(() => db.close());
await register(db, { email: "quick@test.com", password: "password123" });
const { user } = await login(db, { email: "quick@test.com", password: "password123" });

test("a remembered device signs in without the password, and each token works once", async () => {
    const first = await issueDeviceToken(db, user.id);
    const r = await deviceLogin(db, first);
    assert.equal(r.user.email, "quick@test.com");
    assert.ok(r.token && r.deviceToken && r.deviceToken !== first);
    await assert.rejects(deviceLogin(db, first), /免密登录已失效/);
    assert.equal((await deviceLogin(db, r.deviceToken)).user.id, user.id);
});

test("forgetting the device, a disabled account or a password change stop one-click sign-in", async () => {
    const t1 = await issueDeviceToken(db, user.id);
    await forgetDevice(db, t1);
    await assert.rejects(deviceLogin(db, t1), /免密登录已失效/);

    const t2 = await issueDeviceToken(db, user.id);
    await setUserDisabled(db, user.id, true);
    await assert.rejects(deviceLogin(db, t2), /停用/);
    await setUserDisabled(db, user.id, false);

    const t3 = await issueDeviceToken(db, user.id);
    await changePassword(db, user.id, { oldPassword: "password123", newPassword: "password456" });
    await assert.rejects(deviceLogin(db, t3), /免密登录已失效/);
    await assert.rejects(deviceLogin(db, "made-up"), /免密登录已失效/);
});
