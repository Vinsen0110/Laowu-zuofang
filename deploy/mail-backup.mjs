// Emails a daily copy of the database to the admin, so a lost server does not
// lose users' balances, the ledger or unredeemed codes. Supplier keys, mail
// settings and sessions are left out (re-paste them on the admin page).
//   sudo -u laowu bash -c 'cd /srv/laowu/app && set -a && . /etc/laowu/laowu.env && node deploy/mail-backup.mjs'
// Restore: pg_restore --data-only -d laowu laowu-YYYY-MM-DD.dump (after the app has created the tables)
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getMailSettings } from "../account/channels.js";
import { getDatabase } from "../account/db.js";
import { sendAdminMail, setResendKey } from "../account/mailer.js";
import { adminNames } from "../account/service.js";

const SKIPPED = ["lw_settings", "lw_channels", "lw_sessions", "lw_email_codes", "lw_login_attempts"];

const { stdout } = await promisify(execFile)(
    "pg_dump",
    ["-Fc", ...SKIPPED.map((t) => `--exclude-table-data=${t}`), process.env.DATABASE_URL],
    { encoding: "buffer", maxBuffer: 20 * 1024 * 1024 },
);
const db = await getDatabase();
setResendKey((await getMailSettings(db)).key);
const day = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" });
const [{ users }] = await db.query("SELECT count(*)::int AS users FROM lw_users");
const result = await sendAdminMail(adminNames(), {
    subject: `老屋作坊数据库备份 ${day}`,
    text: `附件是 ${day} 的数据库备份（${users} 个用户，${(stdout.length / 1024).toFixed(1)} KB）。\n里面有用户余额、收支记录、兑换码和价格表，不含各站点的 Key。请保留这封邮件，服务器出问题时用它恢复。`,
    attachments: [{ filename: `laowu-${day}.dump`, content: stdout.toString("base64") }],
});
if (!result.delivered) {
    console.error("Backup mail was not sent");
    process.exit(1);
}
console.log(`Backup mailed (${stdout.length} bytes)`);
process.exit(0);
