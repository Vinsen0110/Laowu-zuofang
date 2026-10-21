// Sends account emails (verification codes).
//
// Production: set RESEND_API_KEY and LW_MAIL_FROM (e.g. "老屋作坊 <no-reply@vinsen.top>").
// Local preview without RESEND_API_KEY: nothing is sent; the code is printed in
// the terminal and shown on the page so the flow can be tested.

export function mailConfigured() {
    return Boolean(String(process.env.RESEND_API_KEY || "").trim());
}

// Show codes on the page only when no mail service is set up AND we are not on Vercel.
export function devCodesVisible() {
    return !mailConfigured() && !process.env.VERCEL;
}

function codeEmail(code, purpose) {
    const action = purpose === "reset" ? "重置密码" : "注册账号";
    const subject = `老屋作坊${action}验证码：${code}`;
    const text = `你的老屋作坊${action}验证码是 ${code}，10 分钟内有效。\n如果这不是你本人的操作，请忽略这封邮件。`;
    const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Microsoft YaHei',sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#1f2937">
  <h2 style="margin:0 0 12px;font-size:18px">老屋作坊 · ${action}</h2>
  <p style="margin:0 0 16px;color:#475569">你的验证码是：</p>
  <div style="font-size:32px;font-weight:800;letter-spacing:8px;padding:14px 18px;background:#f1f5f9;border-radius:10px;text-align:center">${code}</div>
  <p style="margin:16px 0 0;color:#64748b;font-size:13px">10 分钟内有效。如果这不是你本人的操作，请忽略这封邮件。</p>
</div>`;
    return { subject, text, html };
}

export async function sendCodeEmail(to, code, purpose, { fetchImpl = fetch } = {}) {
    if (!mailConfigured()) {
        console.log(`[本地预览] 发给 ${to} 的${purpose === "reset" ? "重置密码" : "注册"}验证码：${code}`);
        return { delivered: false };
    }
    const from = String(process.env.LW_MAIL_FROM || "老屋作坊 <onboarding@resend.dev>").trim();
    const { subject, text, html } = codeEmail(code, purpose);
    const res = await fetchImpl("https://api.resend.com/emails", {
        method: "POST",
        headers: {
            Authorization: `Bearer ${String(process.env.RESEND_API_KEY).trim()}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({ from, to: [to], subject, text, html }),
    });
    if (!res.ok) {
        const detail = await res.text().catch(() => "");
        console.error("Resend send failed:", res.status, detail.slice(0, 300));
        throw new Error("验证码邮件发送失败，请稍后再试");
    }
    return { delivered: true };
}

// Notices for the site owner (e.g. a supplier balance running low).
export async function sendAdminMail(to, { subject, text, html }, { fetchImpl = fetch } = {}) {
    const recipients = (Array.isArray(to) ? to : [to]).filter(Boolean);
    if (!recipients.length) return { delivered: false };
    if (!mailConfigured()) {
        console.log(`[本地预览] 管理员邮件 → ${recipients.join(", ")}：${subject}\n${text}`);
        return { delivered: false };
    }
    const from = String(process.env.LW_MAIL_FROM || "老屋作坊 <onboarding@resend.dev>").trim();
    const res = await fetchImpl("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${String(process.env.RESEND_API_KEY).trim()}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from, to: recipients, subject, text, html }),
    });
    if (!res.ok) {
        const detail = await res.text().catch(() => "");
        console.error("Resend admin mail failed:", res.status, detail.slice(0, 300));
        return { delivered: false };
    }
    return { delivered: true };
}
