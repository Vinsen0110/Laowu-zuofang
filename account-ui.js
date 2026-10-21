/* 老屋作坊 account entry: sign in / register, balance, redeem codes.
 * Talks to /api/account/*. Exposes window.__lwAccount for other modules. */
(function () {
  "use strict";

  const API = "/api/account";
  const listeners = new Set();
  let user = null;
  let loaded = false;
  let mode = "login"; // login | register
  let open = false;
  let busy = false;
  let ledgerItems = [];
  let siteBalances = null; // admin only: upstream balances of the site's keys
  let siteBalanceTimer = null;
  let message = null; // { type: "error" | "ok", text }

  const css = `
.lw-acct{--a-bg:var(--lw-white,#fff);--a-text:var(--lw-ink-cool-900,#1f2937);--a-muted:var(--lw-slate-cool-500,#64748b);--a-border:var(--lw-cool-gray-180,#e2e8f0);--a-soft:var(--lw-cool-gray-50,#f8fafc);--a-primary:var(--lw-green-teal-700,#22795a);--a-primary-hover:var(--lw-green-teal-800,#1b604a);--a-err-bg:var(--lw-red-tint-50,#fef2f2);--a-err:var(--lw-red-wine-700,#b91c1c);position:fixed;top:12px;right:12px;z-index:2147483000;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif;color:var(--a-text);letter-spacing:0}
.dark .lw-acct{--a-bg:var(--lw-ink-cool-850,#1e2430);--a-text:var(--lw-cool-gray-60,#f1f5f9);--a-muted:var(--lw-cool-gray-350,#94a3b8);--a-border:var(--lw-ink-cool-700,#334155);--a-soft:var(--lw-ink-cool-950,#11151c);--a-primary:var(--lw-green-teal-650,#26875f);--a-primary-hover:var(--lw-green-teal-600,#2e9a6d);--a-err-bg:var(--lw-red-wine-950,#3b0d0d);--a-err:var(--lw-red-tint-300,#fca5a5)}
.lw-acct *{box-sizing:border-box}
.lw-acct-chip{display:inline-flex;align-items:center;gap:8px;height:36px;padding:0 12px 0 6px;border:1px solid var(--a-border);border-radius:999px;background:var(--a-bg);color:var(--a-text);font-weight:600;font-size:13px;font-family:inherit;cursor:pointer;box-shadow:0 4px 14px rgb(15 23 42 / .08);transition:border-color .15s,box-shadow .15s}
.lw-acct-chip:hover{border-color:var(--a-primary);box-shadow:0 6px 18px rgb(15 23 42 / .12)}
.lw-acct-chip.is-guest{padding:0 14px}
.lw-acct-avatar{display:grid;place-items:center;width:26px;height:26px;border-radius:50%;background:var(--a-primary);color:#fff;font-size:12px;font-weight:700}
.lw-acct-bal{font-variant-numeric:tabular-nums}
.lw-acct-bal.is-low{color:var(--a-err)}
.lw-acct-panel{position:absolute;top:44px;right:0;width:320px;max-width:calc(100vw - 24px);padding:18px;border:1px solid var(--a-border);border-radius:16px;background:var(--a-bg);box-shadow:0 18px 50px rgb(15 23 42 / .18);display:none}
.lw-acct.is-open .lw-acct-panel{display:block}
.lw-acct-tabs{display:grid;grid-template-columns:1fr 1fr;gap:4px;padding:4px;margin-bottom:14px;border-radius:10px;background:var(--a-soft)}
.lw-acct-tab{height:32px;border:0;border-radius:7px;background:transparent;color:var(--a-muted);font-weight:600;font-size:13px;font-family:inherit;cursor:pointer}
.lw-acct-tab[aria-selected="true"]{background:var(--a-bg);color:var(--a-text);box-shadow:0 1px 3px rgb(15 23 42 / .1)}
.lw-acct-form{display:flex;flex-direction:column;gap:10px}
.lw-acct-label{display:flex;flex-direction:column;gap:5px;color:var(--a-muted);font-size:12px;font-weight:600}
.lw-acct-input{height:38px;padding:0 11px;border:1px solid var(--a-border);border-radius:9px;background:var(--a-bg);color:var(--a-text);font-size:14px;font-family:inherit;outline:none}
.lw-acct-input:focus{border-color:var(--a-primary);box-shadow:0 0 0 3px rgb(34 121 90 / .15)}
.lw-acct-btn{height:38px;border:0;border-radius:9px;background:var(--a-primary);color:#fff;font-weight:700;font-size:14px;font-family:inherit;cursor:pointer}
.lw-acct-btn:hover{background:var(--a-primary-hover)}
.lw-acct-btn:disabled{opacity:.6;cursor:default}
.lw-acct-btn.is-ghost{background:transparent;color:var(--a-muted);border:1px solid var(--a-border)}
.lw-acct-btn.is-ghost:hover{color:var(--a-text);background:var(--a-soft)}
.lw-acct-linkbtn{padding:0;border:0;background:none;color:var(--a-muted);font-size:12px;font-weight:600;font-family:inherit;cursor:pointer}
.lw-acct-linkbtn:hover{color:var(--a-primary);text-decoration:underline}
.lw-acct-forgot{align-self:center;margin-top:2px}
.lw-acct-reset-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;font-size:14px}
.lw-acct-send{flex:0 0 auto;min-width:104px;padding:0 10px;font-size:12px}
.lw-acct-msg{padding:8px 10px;border-radius:8px;font-size:12px;line-height:1.5}
.lw-acct-msg.is-error{background:var(--a-err-bg);color:var(--a-err)}
.lw-acct-msg.is-ok{background:rgb(34 121 90 / .12);color:var(--a-primary)}
.lw-acct-head{display:flex;align-items:center;gap:10px;margin-bottom:14px}
.lw-acct-head .lw-acct-avatar{width:36px;height:36px;font-size:15px}
.lw-acct-name{font-size:15px;font-weight:700}
.lw-acct-role{color:var(--a-muted);font-size:12px}
.lw-acct-balance{padding:14px;margin-bottom:12px;border-radius:12px;background:var(--a-soft)}
.lw-acct-balance-label{color:var(--a-muted);font-size:12px;font-weight:600}
.lw-acct-balance-top{display:flex;align-items:center;justify-content:space-between;gap:8px}
.lw-acct-buy{display:inline-flex;align-items:center;height:26px;padding:0 10px;border-radius:999px;background:linear-gradient(135deg,#ecfdf5,#bbf7d0);border:1px solid #a7f3d0;color:#065f46;font-size:12px;font-weight:700;text-decoration:none}
.lw-acct-buy:hover{border-color:#6ee7b7}
.lw-entry-acct .lw-entry-mini.lw-entry-buy{display:inline-grid;place-items:center;text-decoration:none;background:linear-gradient(135deg,#ecfdf5,#bbf7d0);border-color:#a7f3d0;color:#065f46;font-weight:700}
.lw-acct-balance-value{margin-top:2px;font-size:28px;font-weight:800;font-variant-numeric:tabular-nums}
.lw-acct-row{display:flex;gap:8px}
.lw-acct-row .lw-acct-input{flex:1;min-width:0;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;text-transform:uppercase}
.lw-acct-row .lw-acct-btn{padding:0 14px}
.lw-acct-section{margin-top:14px}
.lw-acct-section-title{margin-bottom:6px;color:var(--a-muted);font-size:12px;font-weight:700}
.lw-acct-sites{display:inline-flex;flex-wrap:wrap;gap:4px 10px;align-items:center;font-size:12px;font-weight:500;color:var(--a-muted)}
.lw-acct-site b{color:var(--a-text);font-variant-numeric:tabular-nums}
.lw-acct-site.is-low b{color:var(--a-err)}
@media(max-width:640px){.lw-acct-chip .lw-acct-sites{display:none}}
.lw-acct{display:flex;flex-direction:column;align-items:flex-end}
.lw-acct-admin-tag{font-size:12px;font-weight:700;letter-spacing:.04em}
.lw-acct-chip.is-user{gap:6px;padding:0 14px 0 5px;border-color:#d1fae5;background:linear-gradient(135deg,#f7fefb,#e6fbf1);color:#047857;box-shadow:0 3px 10px rgb(16 185 129 / .10)}
.lw-acct-chip.is-user:hover{border-color:#a7f3d0;box-shadow:0 4px 14px rgb(16 185 129 / .16)}
.lw-acct-chip.is-user .lw-acct-avatar{background:linear-gradient(135deg,#6ee7b7,#34d399);color:#fff}
.lw-acct-chip.is-user .lw-acct-wallet{display:inline-grid;place-items:center;opacity:.85}
.lw-acct-chip.is-user .lw-acct-bal{font-size:14px;font-weight:800;letter-spacing:.01em}
.lw-acct-chip.is-user.is-low{border-color:#fed7aa;background:linear-gradient(135deg,#fffaf5,#fff1e6);color:#c2410c;box-shadow:0 3px 10px rgb(249 115 22 / .10)}
.lw-acct-chip.is-user.is-low .lw-acct-avatar{background:linear-gradient(135deg,#fdba74,#fb923c)}
.dark .lw-acct-chip.is-user{border-color:rgb(52 211 153 / .35);background:linear-gradient(135deg,rgb(6 78 59 / .55),rgb(4 120 87 / .45));color:#d1fae5}
.dark .lw-acct-chip.is-user.is-low{border-color:rgb(248 113 113 / .35);background:linear-gradient(135deg,rgb(124 45 18 / .5),rgb(127 29 29 / .5));color:#fecaca}
.lw-acct-chip.is-admin{padding:0 14px 0 5px;border-color:transparent;background:linear-gradient(135deg,#111827,#374151);color:#f9fafb;box-shadow:0 6px 18px rgb(15 23 42 / .28)}
.lw-acct-chip.is-admin:hover{border-color:transparent}
.lw-acct-chip.is-admin .lw-acct-avatar{background:linear-gradient(135deg,#f59e0b,#fbbf24);color:#111827}
.lw-acct-sitestack{display:flex;flex-direction:column;align-items:flex-end;gap:4px;margin-top:6px}
.lw-acct-siterow{position:relative;display:flex;align-items:center;justify-content:space-between;gap:14px;min-width:138px;height:28px;padding:0 12px 0 22px;border:1px solid var(--a-border);border-radius:10px;background:color-mix(in srgb,var(--a-bg) 88%,transparent);backdrop-filter:blur(8px);color:var(--a-text);font-size:12px;text-decoration:none;box-shadow:0 4px 12px rgb(15 23 42 / .08);transition:border-color .15s,transform .15s}
.lw-acct-siterow::before{content:"";position:absolute;left:10px;top:50%;width:6px;height:6px;margin-top:-3px;border-radius:50%;background:var(--a-primary)}
a.lw-acct-siterow:hover{transform:translateX(-2px)}
.lw-acct-siterow.is-low::before,.lw-acct-siterow.is-error::before{background:var(--a-err)}
.lw-acct-siterow.is-loading::before{background:var(--a-muted)}
a.lw-acct-siterow:hover{border-color:var(--a-primary)}
.lw-acct-siterow-name{color:var(--a-muted)}
.lw-acct-siterow b{font-variant-numeric:tabular-nums}
.lw-acct-siterow.is-low{border-color:var(--a-err)}
.lw-acct-siterow.is-low b,.lw-acct-siterow.is-error b{color:var(--a-err)}
.lw-acct-siterow.is-loading{color:var(--a-muted)}
.lw-acct.is-open .lw-acct-sitestack{visibility:hidden}
.lw-entry-user{flex-wrap:wrap}
.lw-entry-user .lw-acct-sites{order:10;flex-basis:100%;padding-left:34px}
.lw-acct-howto{margin:0 0 14px;padding:10px 12px;border-radius:10px;background:var(--a-soft);font-size:12px;line-height:1.6;color:var(--a-muted)}
.lw-acct-howto b{color:var(--a-text)}
.lw-acct-ledger{max-height:180px;overflow:auto;border:1px solid var(--a-border);border-radius:10px}
.lw-acct-ledger-row{display:flex;justify-content:space-between;gap:10px;padding:8px 10px;border-top:1px solid var(--a-border);font-size:12px}
.lw-acct-ledger-row:first-child{border-top:0}
.lw-acct-ledger-note{display:flex;flex-direction:column;gap:2px;min-width:0}
.lw-acct-ledger-time{color:var(--a-muted);font-size:11px}
.lw-acct-ledger-amt{font-weight:700;font-variant-numeric:tabular-nums;white-space:nowrap}
.lw-acct-ledger-amt.is-plus{color:var(--a-primary)}
.lw-acct-empty{padding:14px;color:var(--a-muted);font-size:12px;text-align:center}
.lw-acct-foot{display:flex;gap:8px;margin-top:14px}
.lw-acct-foot>*{flex:1}
.lw-acct-link{display:grid;place-items:center;height:38px;border:1px solid var(--a-border);border-radius:9px;color:var(--a-text);font-size:13px;font-weight:600;text-decoration:none}
.lw-acct-link:hover{background:var(--a-soft)}
.lw-start .lw-acct{display:none}
.canvas-balance-stack{display:none !important}
.startup-entry.lw-gated .startup-entry-workspace>h2,.startup-entry.lw-gated .startup-entry-actions{display:none}
.lw-entry-acct{--a-bg:var(--entry-button,#fff);--a-text:var(--entry-text,#1f2937);--a-muted:var(--entry-muted,#64748b);--a-border:var(--entry-border,#e2e8f0);--a-soft:var(--entry-hover,#f1f5f9);--a-primary:var(--entry-primary,#22795a);--a-primary-hover:var(--entry-primary-hover,#1b604a);--a-err-bg:var(--entry-error-bg,#fef2f2);--a-err:var(--entry-error-text,#b91c1c);margin-top:18px;color:var(--a-text);font-family:inherit}
.lw-entry-acct *{box-sizing:border-box}
.lw-entry-acct.is-guest{margin-top:0;padding:22px;border:1px solid var(--a-border);border-radius:14px;background:var(--a-bg)}
.lw-entry-acct .lw-entry-title{color:var(--a-text);margin:0 0 4px;font-size:16px;font-weight:700}
.lw-entry-acct .lw-entry-sub{margin:0 0 16px;color:var(--a-muted);font-size:13px}
.lw-entry-acct .lw-acct-tabs{background:var(--a-soft)}
.lw-entry-acct .lw-acct-btn{height:42px}
.lw-entry-acct .lw-acct-input{height:42px}
.lw-entry-user{display:flex;flex-wrap:wrap;align-items:center;gap:10px;padding:12px 14px;border:1px solid var(--a-border);border-radius:12px;background:var(--a-bg);font-size:13px}
.lw-entry-user .lw-acct-avatar{width:30px;height:30px}
.lw-entry-user-name{font-weight:700}
.lw-entry-user-bal{color:var(--a-muted)}
.lw-entry-user-bal b{color:var(--a-text);font-variant-numeric:tabular-nums}
.lw-entry-spacer{flex:1}
.lw-entry-mini{height:30px;padding:0 12px;border:1px solid var(--a-border);border-radius:8px;background:transparent;color:var(--a-text);font-size:12px;font-weight:600;font-family:inherit;cursor:pointer}
.lw-entry-mini:hover{background:var(--a-soft)}
.lw-entry-redeem{margin-top:10px}
@media(max-width:640px){.lw-acct{top:8px;right:8px}.lw-acct-chip .lw-acct-label-text{display:none}}
`;

  // Balances are shown in a neutral unit (not ¥ or $). The canvas uses the same unit.
  const UNIT = "฿";
  const LOW_BALANCE = 10; // badge turns warm below this
  // Where users buy redeem codes.
  const BUY_URL = "https://catfk.com/shop/AV0594PI";
  globalThis.__lwUnit = UNIT;

  function money(n) {
    const v = Number(n) || 0;
    const fixed = Math.abs(v * 100 - Math.round(v * 100)) > 1e-9 ? v.toFixed(3) : v.toFixed(2);
    return `${UNIT}${fixed}`;
  }

  function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function timeText(t) {
    try {
      const d = new Date(t);
      const pad = (x) => String(x).padStart(2, "0");
      return `${d.getMonth() + 1}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    } catch (_) { return ""; }
  }

  async function api(path, options = {}) {
    const response = await fetch(`${API}${path}`, {
      method: options.method || "GET",
      credentials: "same-origin",
      headers: options.body ? { "Content-Type": "application/json" } : undefined,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    let data = {};
    try { data = await response.json(); } catch (_) { /* empty */ }
    if (!response.ok) throw new Error(data?.error?.message || `请求失败（${response.status}）`);
    return data;
  }

  const SITE_SHORT = { tudou: "土豆", apimart: "Mart", grsai: "Grsai", runninghub: "RH", soon: "Soon" };

  // GPT Image 2.5 "official" mode is admin-only. The app bundle reads this flag
  // and the shared option list; the server refuses official requests from users.
  function applyRole(tries = 0) {
    const admin = user?.role === "admin";
    globalThis.__lwIsAdmin = admin;
    globalThis.__lwGptOfficial = admin;
    const options = globalThis.__lwGptModeOptions;
    if (!options) {
      if (tries < 40) setTimeout(() => applyRole(tries + 1), 250);
      return;
    }
    const has = options.some((o) => o.value === "official");
    if (admin && !has) options.push({ value: "official", label: "官方" });
    if (!admin && has) options.splice(options.findIndex((o) => o.value === "official"), 1);
  }

  async function refreshSiteBalance(id) {
    try {
      const [fresh] = (await api(`/admin/channel-balances?id=${encodeURIComponent(id)}`)).items || [];
      if (!fresh) return;
      siteBalances = (siteBalances || []).some((b) => b.id === id)
        ? siteBalances.map((b) => (b.id === id ? fresh : b))
        : [...(siteBalances || []), fresh];
      render();
    } catch (_) { /* keep last value */ }
  }

  async function loadSiteBalances() {
    if (user?.role !== "admin") return;
    try { siteBalances = (await api("/admin/channel-balances")).items || []; } catch (_) { /* keep last */ }
    render();
  }

  function siteBalanceText(b) {
    if (b.balance === undefined || b.balance === null) return "--";
    if (b.balance < 0) return "无限";
    return `${b.unit || "$"}${Number(b.balance).toFixed(2)}`;
  }

  function siteBalancesInline() {
    if (!siteBalances) return `<span class="lw-acct-sites-loading">站点余额…</span>`;
    return siteBalances.map((b) => `<span class="lw-acct-site ${b.status === "low" ? "is-low" : ""}" title="${esc(b.message || b.detail || "")}">${esc(SITE_SHORT[b.id] || b.name)} <b>${esc(siteBalanceText(b))}</b></span>`).join("");
  }

  // Admin canvas: one site per row under the avatar, right-aligned; each row opens that site's top-up page.
  function siteBalanceStack() {
    if (!siteBalances) return `<div class="lw-acct-sitestack"><span class="lw-acct-siterow is-loading">站点余额加载中…</span></div>`;
    return `<div class="lw-acct-sitestack" aria-label="站点余额">${siteBalances.map((b) => {
      const label = `<span class="lw-acct-siterow-name">${esc(SITE_SHORT[b.id] || b.name)}</span><b>${esc(siteBalanceText(b))}</b>`;
      const cls = `lw-acct-siterow ${b.status === "low" ? "is-low" : ""} ${b.status === "error" ? "is-error" : ""}`;
      const title = esc(b.message || b.detail || "");
      return b.topupUrl
        ? `<a class="${cls}" href="${esc(b.topupUrl)}" target="_blank" rel="noopener noreferrer" title="${title || "去充值"}">${label}</a>`
        : `<span class="${cls}" title="${title}">${label}</span>`;
    }).join("")}</div>`;
  }

  function setUser(next) {
    const sameUser = Boolean(user && next && user.id === next.id && user.role === next.role);
    user = next;
    loaded = true;
    applyRole();
    if (sameUser) {
      listeners.forEach((fn) => { try { fn(user); } catch (_) { /* ignore */ } });
      render();
      return;
    }
    clearInterval(siteBalanceTimer);
    siteBalances = null;
    globalThis.__lwCloudinary = null;
    globalThis.__lwPrices = null;
    if (user && user.role !== "admin") {
      // Selling prices for the canvas price display (the relay charges the same table).
      api("/prices").then((r) => { globalThis.__lwPrices = r.items || []; window.dispatchEvent(new Event("lw-prices-loaded")); }).catch(() => {});
    }
    if (user?.role === "admin") {
      api("/admin/cloudinary").then((c) => { globalThis.__lwCloudinary = c; }).catch(() => {});
      loadSiteBalances(); // once on sign-in; afterwards only the site just used is refreshed
    }
    listeners.forEach((fn) => { try { fn(user); } catch (_) { /* ignore */ } });
    render();
  }

  // After a generation: users refresh their own balance; the admin refreshes
  // only the site that was just used.
  const SITE_BY_HOST = [
    [/(^|\.)ai-tudou\.net$/, "tudou"], [/(^|\.)apimart\.ai$/, "apimart"], [/(^|\.)grsaiapi\.com$/, "grsai"],
    [/(^|\.)runninghub\.ai$/, "runninghub"], [/(^|\.)soonstudio\.ai$/, "soon"],
  ];
  const pendingSites = new Set();
  let balanceRefreshTimer = null;
  window.addEventListener("lw-balance-changed", (event) => {
    if (!user) return;
    if (user.role === "admin") {
      let host = "";
      try { host = new URL(event.detail?.url || "", location.href).hostname; } catch (_) { /* ignore */ }
      const site = SITE_BY_HOST.find(([re]) => re.test(host))?.[1];
      if (site) pendingSites.add(site);
    }
    clearTimeout(balanceRefreshTimer);
    balanceRefreshTimer = setTimeout(() => {
      if (user?.role !== "admin") { refresh(); return; }
      const sites = [...pendingSites];
      pendingSites.clear();
      sites.forEach(refreshSiteBalance);
    }, 1500);
  });

  async function refresh() {
    try {
      const data = await api("/me");
      setUser(data.user);
      if (user?.role === "admin" && open) await loadLedger();
    } catch (_) {
      loaded = true;
      render();
    }
    return user;
  }

  async function loadLedger() {
    try {
      ledgerItems = (await api("/ledger?limit=20")).items || [];
    } catch (_) { ledgerItems = []; }
    render();
  }

  const KIND_TEXT = { redeem: "兑换码充值", admin: "管理员调整", usage: "生成消费", refund: "失败退款" };

  let cooldownUntil = 0;
  let codeSentTo = "";

  function cooldownLeft() {
    return Math.max(0, Math.ceil((cooldownUntil - Date.now()) / 1000));
  }

  function sendCodeLabel() {
    const left = cooldownLeft();
    return left ? `${left} 秒后重发` : codeSentTo ? "重新发送" : "发送验证码";
  }

  function guestView() {
    const isReg = mode === "register";
    const isReset = mode === "reset";
    const needsCode = isReg || isReset;
    const formKind = isReg ? "register" : isReset ? "reset" : "login";
    const submitText = isReg ? "注册并登录" : isReset ? "重置密码并登录" : "登录";
    return `
      ${isReset ? `<div class="lw-acct-reset-head"><button type="button" class="lw-acct-linkbtn" data-act="mode-login">← 返回登录</button></div>` : `
      <div class="lw-acct-tabs" role="tablist">
        <button type="button" class="lw-acct-tab" role="tab" aria-selected="${!isReg}" data-act="mode-login">登录</button>
        <button type="button" class="lw-acct-tab" role="tab" aria-selected="${isReg}" data-act="mode-register">注册</button>
      </div>`}
      <form class="lw-acct-form" data-form="${formKind}" novalidate>
        <label class="lw-acct-label">邮箱
          <input class="lw-acct-input" name="email" type="email" autocomplete="email" required maxlength="120" placeholder="you@example.com">
        </label>
        ${needsCode ? `<label class="lw-acct-label">邮箱验证码
          <span class="lw-acct-row">
            <input class="lw-acct-input lw-acct-vcode" name="vcode" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="6 位数字">
            <button type="button" class="lw-acct-btn is-ghost lw-acct-send" data-act="send-code" ${cooldownLeft() || busy ? "disabled" : ""}>${sendCodeLabel()}</button>
          </span>
        </label>` : ""}
        <label class="lw-acct-label">${isReset ? "新密码" : "密码"}
          <input class="lw-acct-input" name="password" type="password" autocomplete="${needsCode ? "new-password" : "current-password"}" required minlength="8" placeholder="至少 8 位">
        </label>
        ${needsCode ? `<label class="lw-acct-label">确认${isReset ? "新" : ""}密码
          <input class="lw-acct-input" name="confirm" type="password" autocomplete="new-password" required minlength="8">
        </label>` : ""}
        ${msgView()}
        <button class="lw-acct-btn" type="submit" ${busy ? "disabled" : ""}>${busy ? "请稍候…" : submitText}</button>
        ${!needsCode ? `<button type="button" class="lw-acct-linkbtn lw-acct-forgot" data-act="mode-reset">忘记密码？</button>` : ""}
      </form>`;
  }

  async function sendCode(button) {
    const form = button.closest("form");
    const email = form.querySelector('input[name="email"]').value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
      message = { type: "error", text: "请先填写正确的邮箱地址" };
      render();
      form.querySelector('input[name="email"]')?.focus();
      return;
    }
    button.disabled = true;
    button.textContent = "发送中…";
    try {
      const result = await api("/send-code", { method: "POST", body: { email, purpose: mode === "reset" ? "reset" : "register" } });
      codeSentTo = email;
      cooldownUntil = Date.now() + (result.resendAfter || 60) * 1000;
      message = result.devCode
        ? { type: "ok", text: `本地测试模式：验证码是 ${result.devCode}（正式上线后会发送到邮箱）` }
        : { type: "ok", text: `验证码已发送到 ${email}，10 分钟内有效。没收到的话请看看垃圾邮件箱。` };
    } catch (error) {
      message = { type: "error", text: error.message };
    }
    render();
    document.querySelector('.lw-acct-vcode')?.focus();
  }

  setInterval(() => {
    if (!cooldownUntil) return;
    document.querySelectorAll('[data-act="send-code"]').forEach((b) => {
      b.textContent = sendCodeLabel();
      b.disabled = cooldownLeft() > 0 || busy;
    });
    if (!cooldownLeft()) cooldownUntil = 0;
  }, 1000);

  function msgView() {
    if (!message) return "";
    return `<div class="lw-acct-msg ${message.type === "error" ? "is-error" : "is-ok"}" role="${message.type === "error" ? "alert" : "status"}">${esc(message.text)}</div>`;
  }

  function userView() {
    const rows = ledgerItems.length
      ? ledgerItems.map((i) => `
        <div class="lw-acct-ledger-row">
          <span class="lw-acct-ledger-note"><span>${esc(i.note || KIND_TEXT[i.kind] || i.kind)}</span><span class="lw-acct-ledger-time">${esc(timeText(i.createdAt))}</span></span>
          <span class="lw-acct-ledger-amt ${i.amount > 0 ? "is-plus" : ""}">${i.amount > 0 ? "+" : "−"}${esc(money(Math.abs(i.amount)).slice(1))}</span>
        </div>`).join("")
      : `<div class="lw-acct-empty">还没有记录</div>`;
    return `
      <div class="lw-acct-head">
        <span class="lw-acct-avatar" aria-hidden="true">${esc((user.displayName || user.email).slice(0, 1).toUpperCase())}</span>
        <span><div class="lw-acct-name">${esc(user.displayName || user.email)}</div><div class="lw-acct-role">${esc(user.email)}</div></span>
      </div>
      <div class="lw-acct-balance">
        <div class="lw-acct-balance-top"><span class="lw-acct-balance-label">账户余额</span>${user.role === "admin" ? "" : `<a class="lw-acct-buy" href="${BUY_URL}" target="_blank" rel="noopener noreferrer">购买兑换码 ↗</a>`}</div>
        <div class="lw-acct-balance-value">${esc(money(user.balance))}</div>
      </div>
      <form class="lw-acct-form" data-form="redeem">
        <label class="lw-acct-label" for="lw-acct-code">兑换码充值</label>
        <div class="lw-acct-row">
          <input class="lw-acct-input" id="lw-acct-code" name="code" placeholder="LW-XXXX-XXXX-XXXX-XXXX" autocomplete="off" spellcheck="false" required>
          <button class="lw-acct-btn" type="submit" ${busy ? "disabled" : ""}>兑换</button>
        </div>
        ${msgView()}
      </form>
      <div class="lw-acct-howto">生成时按价格表从余额扣费。生成失败一般会自动退回，没有退回的请联系管理员。</div>
      ${user.role === "admin" ? `<div class="lw-acct-section">
        <div class="lw-acct-section-title">最近记录</div>
        <div class="lw-acct-ledger">${rows}</div>
      </div>` : ""}
      <div class="lw-acct-foot">
        ${user.role === "admin" ? `<a class="lw-acct-link" href="/admin.html" target="_blank" rel="noopener">管理后台</a>` : ""}
        <button type="button" class="lw-acct-btn is-ghost" data-act="logout">退出登录</button>
      </div>`;
  }

  let host = null;

  function render() {
    if (!host) return;
    const chip = user
      ? `<button type="button" class="lw-acct-chip ${user.role === "admin" ? "is-admin" : `is-user ${user.balance < LOW_BALANCE ? "is-low" : ""}`}" data-act="toggle" aria-expanded="${open}" aria-label="账户：${esc(user.email)}${user.role === "admin" ? "" : `，余额 ${esc(money(user.balance))}`}">
           <span class="lw-acct-avatar" aria-hidden="true">${esc((user.displayName || user.email).slice(0, 1).toUpperCase())}</span>
           ${user.role === "admin"
             ? `<span class="lw-acct-admin-tag">管理员</span>`
             : `<span class="lw-acct-wallet" aria-hidden="true"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12V8H6a2 2 0 0 1 0-4h12v4"/><path d="M4 6v12a2 2 0 0 0 2 2h14v-4"/><path d="M18 12a2 2 0 0 0 0 4h4v-4z"/></svg></span><span class="lw-acct-bal">${esc(money(user.balance))}</span>`}
         </button>${user.role === "admin" ? siteBalanceStack() : ""}`
      : `<button type="button" class="lw-acct-chip is-guest" data-act="toggle" aria-expanded="${open}">${loaded ? `<span class="lw-acct-label-text">登录 / 注册</span><span aria-hidden="true" class="lw-acct-label-short">账户</span>` : "…"}</button>`;
    paint(host, `${chip}<div class="lw-acct-panel" role="dialog" aria-label="账户">${user ? userView() : guestView()}</div>`);
    host.classList.toggle("is-open", open);
    if (entry || document.querySelector(".startup-entry-workspace")) renderEntry(true);
  }

  function paint(el, html) {
    const active = document.activeElement;
    const focusName = active && el.contains(active) ? active.getAttribute("name") || active.dataset.act : null;
    const kept = {};
    el.querySelectorAll("input[name]").forEach((i) => { kept[i.name] = i.value; });
    el.innerHTML = html;
    el.querySelectorAll("input[name]").forEach((i) => {
      if (kept[i.name] !== undefined && !(message?.type === "ok" && i.name === "code")) i.value = kept[i.name];
    });
    if (focusName) {
      const again = el.querySelector(`[name="${focusName}"], [data-act="${focusName}"]`);
      if (again) again.focus();
    }
  }

  // ---------- start screen card ----------
  let entry = null;
  let entryRedeemOpen = false;

  function entryView() {
    if (!loaded) return `<div class="lw-entry-sub" style="margin:0">正在检查登录状态…</div>`;
    if (!user) {
      return `<h2 class="lw-entry-title">${mode === "register" ? "注册老屋作坊账号" : mode === "reset" ? "找回密码" : "登录老屋作坊"}</h2>
        <p class="lw-entry-sub">${mode === "reset" ? "输入注册时用的邮箱，收到验证码后设置新密码。" : mode === "register" ? "用邮箱注册，验证码会发送到你的邮箱。生成费用从账户余额扣除。" : "登录后即可新建或打开工程，生成费用从账户余额扣除。"}</p>${guestView()}`;
    }
    return `<div class="lw-entry-user">
        <span class="lw-acct-avatar" aria-hidden="true">${esc((user.displayName || user.email).slice(0, 1).toUpperCase())}</span>
        <span class="lw-entry-user-name" title="${esc(user.email)}">${esc(user.email)}</span>
        ${user.role === "admin"
          ? `<span class="lw-entry-user-bal lw-acct-sites">${siteBalancesInline()}</span>`
          : `<span class="lw-entry-user-bal">余额 <b>${esc(money(user.balance))}</b></span>`}
        <span class="lw-entry-spacer"></span>
        ${user.role === "admin" ? "" : `<a class="lw-entry-mini lw-entry-buy" href="${BUY_URL}" target="_blank" rel="noopener noreferrer">购买</a>`}
        <button type="button" class="lw-entry-mini" data-act="entry-redeem" aria-expanded="${entryRedeemOpen}">充值</button>
        ${user.role === "admin" ? `<a class="lw-entry-mini" style="display:inline-grid;place-items:center;text-decoration:none" href="/admin.html" target="_blank" rel="noopener">管理后台</a>` : ""}
        <button type="button" class="lw-entry-mini" data-act="logout">退出</button>
      </div>
      ${entryRedeemOpen ? `<form class="lw-acct-form lw-entry-redeem" data-form="redeem">
        <div class="lw-acct-row">
          <input class="lw-acct-input" name="code" aria-label="兑换码" placeholder="输入兑换码 LW-XXXX-XXXX-XXXX-XXXX" autocomplete="off" spellcheck="false" required>
          <button class="lw-acct-btn" type="submit" ${busy ? "disabled" : ""}>兑换</button>
        </div>${msgView()}</form>` : ""}`;
  }

  function renderEntry(force) {
    const workspace = document.querySelector(".startup-entry-workspace");
    const screen = workspace && workspace.closest(".startup-entry");
    document.documentElement.classList.toggle("lw-start", Boolean(workspace));
    if (!workspace) { entry = null; return; }
    let created = false;
    if (!entry || !workspace.contains(entry)) {
      created = true;
      entry = document.createElement("div");
      entry.className = "lw-entry-acct";
      entry.addEventListener("click", onClick);
      entry.addEventListener("submit", onSubmit);
      workspace.appendChild(entry);
    }
    screen.classList.toggle("lw-gated", loaded && !user);
    entry.classList.toggle("is-guest", !user);
    if (force || created) paint(entry, entryView());
  }

  function placeChip() {
    if (!host || document.documentElement.classList.contains("lw-start")) return;
    host.style.visibility = "hidden";
    let right = 12;
    const y = 26;
    for (let x = window.innerWidth - 8; x > window.innerWidth - 420; x -= 12) {
      const el = document.elementsFromPoint(x, y).find((n) => !host.contains(n) && n !== document.body && n !== document.documentElement && getComputedStyle(n).pointerEvents !== "none");
      if (!el) continue;
      const box = el.getBoundingClientRect();
      if (box.width > window.innerWidth * 0.6 || box.height > 120) continue; // canvas / background layers
      right = Math.max(right, window.innerWidth - box.left + 8);
      x = box.left;
    }
    host.style.right = `${right}px`;
    host.style.visibility = "";
  }

  let scheduled = false;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      renderEntry(false);
      placeChip();
    });
  }

  function setOpen(next) {
    open = next;
    message = null;
    render();
    if (open) {
      if (user?.role === "admin") loadLedger();
      const first = host.querySelector(".lw-acct-panel input");
      if (first) setTimeout(() => first.focus(), 0);
    }
  }

  async function onSubmit(event) {
    const form = event.target.closest("form[data-form]");
    if (!form) return;
    event.preventDefault();
    if (busy) return;
    const data = Object.fromEntries(new FormData(form).entries());
    const kind = form.dataset.form;
    if (kind === "login" || kind === "register" || kind === "reset") {
      let problem = "";
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(data.email || "").trim())) problem = "请填写正确的邮箱地址";
      else if (kind !== "login" && !/^\d{6}$/.test(String(data.vcode || "").trim())) problem = "请填写邮箱收到的 6 位验证码";
      else if (String(data.password || "").length < 8) problem = "密码至少 8 位";
      if (problem) {
        message = { type: "error", text: problem };
        render();
        return;
      }
    }
    if ((kind === "register" || kind === "reset") && data.password !== data.confirm) {
      message = { type: "error", text: "两次输入的密码不一致" };
      render();
      return;
    }
    busy = true;
    message = null;
    render();
    try {
      if (kind === "login" || kind === "register" || kind === "reset") {
        const path = kind === "reset" ? "/password/reset" : `/${kind}`;
        const result = await api(path, { method: "POST", body: { email: data.email, password: data.password, code: data.vcode } });
        codeSentTo = "";
        cooldownUntil = 0;
        mode = "login";
        setUser(result.user);
        await loadLedger();
      } else if (kind === "redeem") {
        const result = await api("/redeem", { method: "POST", body: { code: data.code } });
        message = { type: "ok", text: `充值成功：+${money(result.amount)}` };
        user = { ...user, balance: result.balance };
        setUser(user);
        await loadLedger();
      }
    } catch (error) {
      message = { type: "error", text: error.message };
    } finally {
      busy = false;
      render();
    }
  }

  async function onClick(event) {
    const el = event.target.closest("[data-act]");
    if (!el) return;
    const act = el.dataset.act;
    if (act === "toggle") setOpen(!open);
    else if (act === "entry-redeem") {
      entryRedeemOpen = !entryRedeemOpen;
      message = null;
      render();
      if (entryRedeemOpen) entry?.querySelector('input[name="code"]')?.focus();
    }
    else if (act === "send-code") sendCode(el);

    else if (act === "mode-login" || act === "mode-register" || act === "mode-reset") {
      if (mode !== act.slice(5)) { cooldownUntil = 0; codeSentTo = ""; }
      mode = act.slice(5);
      message = null;
      render();
    } else if (act === "logout") {
      const relay = window.__lwRelay;
      const busy = relay && (relay.inflight > 0 || Date.now() - relay.last < 20000);
      if (busy && !confirm("还有图片正在生成。现在退出，这次生成的结果可能拿不到（已扣的费用可联系管理员处理）。确定退出吗？")) return;
      try { await api("/logout", { method: "POST" }); } catch (_) { /* ignore */ }
      // The canvas needs a signed-in account, so go back to the sign-in screen.
      if (document.querySelector(".laowu-canvas-viewport, .react-flow")) { location.reload(); return; }
      ledgerItems = [];
      entryRedeemOpen = false;
      message = null;
      setUser(null);
      setOpen(false);
    }
  }

  function mount() {
    if (document.getElementById("lw-acct-style")) return;
    const style = document.createElement("style");
    style.id = "lw-acct-style";
    style.textContent = css + ".lw-acct-label-short{display:none}@media(max-width:640px){.lw-acct-label-short{display:inline}}";
    document.head.appendChild(style);
    host = document.createElement("div");
    host.className = "lw-acct";
    document.body.appendChild(host);
    host.addEventListener("click", onClick);
    host.addEventListener("submit", onSubmit);
    document.addEventListener("pointerdown", (e) => {
      if (open && !host.contains(e.target)) setOpen(false);
    });
    document.addEventListener("keydown", (e) => {
      if (open && e.key === "Escape") {
        setOpen(false);
        host.querySelector(".lw-acct-chip")?.focus();
      }
    });
    new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
    window.addEventListener("resize", schedule);
    render();
    refresh();
  }

  window.__lwAccount = {
    getUser: () => user,
    refresh,
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    open: () => setOpen(true),
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount);
  else mount();
})();
