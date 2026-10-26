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
  let editingName = false;
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
.lw-acct-avatar{display:grid;place-items:center;width:26px;height:26px;border-radius:50%;overflow:hidden;background:var(--a-primary);color:#fff;font-size:12px;font-weight:700}
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
.lw-pw{position:relative;display:flex}
.lw-pw .lw-acct-input{flex:1;min-width:0;padding-right:42px !important}
.lw-pw-eye{position:absolute;top:50%;right:6px;translate:0 -50%;display:grid;place-items:center;width:32px;height:32px;padding:0;border:0;border-radius:8px;background:transparent;color:var(--a-muted,var(--g-muted,currentColor));opacity:.75;cursor:pointer}
.lw-pw-eye:hover{opacity:1;background:var(--a-soft,rgb(127 127 127 / .12))}
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
.lw-acct-who{min-width:0;flex:1}
.lw-acct-rename{margin-left:4px;font-size:11px;font-weight:500}
.lw-acct-name-form{display:flex;gap:6px;margin-bottom:2px}
.lw-acct-name-form .lw-acct-input{height:30px;font-size:13px}
.lw-acct-name-form .lw-acct-btn{height:30px;padding:0 10px}
.lw-acct-admin-tag{font-size:12px;font-weight:700;letter-spacing:.04em}
.lw-acct-chip.is-user{gap:6px;padding:0 14px 0 5px;border-color:#d1fae5;background:linear-gradient(135deg,#f7fefb,#e6fbf1);color:#047857;box-shadow:0 3px 10px rgb(16 185 129 / .10)}
.lw-acct-chip.is-user:hover{border-color:#a7f3d0;box-shadow:0 4px 14px rgb(16 185 129 / .16)}
.lw-acct-chip.is-user .lw-acct-avatar{background:linear-gradient(135deg,#6ee7b7,#34d399);color:#fff}
.lw-acct-chip.is-user .lw-acct-wallet{display:inline-grid;place-items:center;opacity:.85}
.lw-acct-chip.is-user .lw-acct-bal{font-size:14px;font-weight:600;letter-spacing:.01em;font-synthesis:none;-webkit-font-smoothing:antialiased}
.lw-acct-chip.is-user.is-low{border-color:#fed7aa;background:linear-gradient(135deg,#fffaf5,#fff1e6);color:#c2410c;box-shadow:0 3px 10px rgb(249 115 22 / .10)}
.lw-acct-chip.is-user.is-low .lw-acct-avatar{background:linear-gradient(135deg,#fdba74,#fb923c)}
.dark .lw-acct-chip.is-user{border-color:rgb(52 211 153 / .35);background:linear-gradient(135deg,rgb(6 78 59 / .55),rgb(4 120 87 / .45));color:#d1fae5}
.dark .lw-acct-chip.is-user.is-low{border-color:rgb(248 113 113 / .35);background:linear-gradient(135deg,rgb(124 45 18 / .5),rgb(127 29 29 / .5));color:#fecaca}
.lw-acct-chip.is-admin{padding:0 14px 0 5px;border-color:transparent;background:linear-gradient(135deg,#111827,#374151);color:#f9fafb;box-shadow:0 6px 18px rgb(15 23 42 / .28)}
.lw-acct-chip.is-admin:hover{border-color:transparent}
.lw-acct-chip.is-admin .lw-acct-avatar{background:linear-gradient(135deg,#f59e0b,#fbbf24);color:#111827}
.lw-acct-sitestack{display:flex;flex-direction:column;align-items:flex-end;gap:4px;margin-top:6px}
.lw-refund-note{position:fixed;top:64px;left:50%;z-index:2147483001;max-width:calc(100vw - 32px);padding:10px 16px;border:1px solid var(--lw-green-teal-200,#b7e4cf);border-radius:12px;background:var(--lw-green-teal-50,#ecfdf5);color:var(--lw-green-teal-800,#1b604a);font:600 13px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif;box-shadow:0 10px 30px rgb(15 23 42 / .12);opacity:0;transform:translate(-50%,-8px);pointer-events:none;transition:opacity .2s,transform .2s}
.lw-refund-note.is-on{opacity:1;transform:translate(-50%,0);pointer-events:auto}
.lw-refund-note.is-warn{border-color:var(--lw-amber-200,#fde68a);background:var(--lw-amber-50,#fffbeb);color:var(--lw-amber-800,#92400e)}
.lw-refund-note a{color:inherit;font-weight:800;text-decoration:underline}
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
/* ---------- account menu (signed in) ---------- */
.lw-acct-panel.is-menu{width:296px;padding:6px;border-radius:12px;box-shadow:0 1px 2px rgb(15 23 42 / .06),0 12px 32px rgb(15 23 42 / .14)}
.lw-am-sec{padding:10px 10px}
.lw-am-sep{height:1px;margin:2px 4px;background:var(--a-border)}
.lw-am-who{display:flex;align-items:center;gap:10px}
.lw-am-avatar{position:relative;flex:0 0 auto;display:grid;place-items:center;width:36px;height:36px;padding:0;border:0;border-radius:50%;background:var(--a-soft);color:var(--a-text);font-size:13px;font-weight:600;cursor:pointer;overflow:hidden}
.lw-am-avatar img,.lw-acct-avatar img{width:100%;height:100%;border-radius:50%;object-fit:cover;display:block}
.lw-am-avatar-edit{position:absolute;inset:0;display:grid;place-items:center;background:rgb(15 23 42 / .45);color:#fff;opacity:0;transition:opacity .12s}
.lw-am-avatar:hover .lw-am-avatar-edit,.lw-am-avatar:focus-visible .lw-am-avatar-edit{opacity:1}
.lw-am-id{min-width:0;flex:1}
.lw-am-name{display:flex;align-items:center;gap:4px;font-size:13px;font-weight:600;line-height:18px}
.lw-am-name span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lw-am-email{overflow:hidden;color:var(--a-muted);font-size:12px;line-height:16px;text-overflow:ellipsis;white-space:nowrap}
.lw-am-icon{display:inline-grid;place-items:center;width:22px;height:22px;padding:0;border:0;border-radius:6px;background:none;color:var(--a-muted);cursor:pointer;opacity:.5;transition:opacity .12s,background .12s,color .12s}
.lw-am-who:hover .lw-am-icon,.lw-am-icon:focus-visible{opacity:1}
.lw-am-icon:hover{background:var(--a-soft);color:var(--a-text)}
.lw-am-rename{display:flex;gap:6px;flex:1}
.lw-am-rename .lw-am-field{height:30px}
.lw-am-label{color:var(--a-muted);font-size:12px;line-height:16px}
.lw-am-balance{display:flex;align-items:center;justify-content:space-between;gap:8px}
.lw-am-amount{font-size:22px;font-weight:600;line-height:28px;font-variant-numeric:tabular-nums;letter-spacing:-.01em}
.lw-am-amount.is-low{color:var(--a-err)}
.lw-am-buy{display:inline-flex;align-items:center;gap:4px;height:26px;padding:0 9px;border:1px solid var(--a-border);border-radius:7px;color:var(--a-text);font-size:12px;font-weight:500;text-decoration:none;transition:background .12s,border-color .12s}
.lw-am-buy:hover{background:var(--a-soft);border-color:var(--a-muted)}
.lw-am-redeem{margin-top:10px}
.lw-am-inputwrap{display:flex;align-items:center;height:34px;padding:0 3px 0 10px;border:1px solid var(--a-border);border-radius:8px;background:var(--a-bg);transition:border-color .12s,box-shadow .12s}
.lw-am-inputwrap:focus-within{border-color:var(--a-primary);box-shadow:0 0 0 3px rgb(34 121 90 / .12)}
.lw-am-inputwrap svg{flex:0 0 auto;color:var(--a-muted)}
.lw-am-field{flex:1;min-width:0;height:32px;padding:0 8px;border:0;background:transparent;color:var(--a-text);font:500 12.5px/1 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.02em;text-transform:uppercase;outline:none}
.lw-am-field::placeholder{color:var(--a-muted);opacity:.6;text-transform:none;font-family:inherit;letter-spacing:0}
.lw-am-rename .lw-am-field{padding:0 9px;border:1px solid var(--a-border);border-radius:7px;font-family:inherit;font-size:13px;font-weight:500;text-transform:none;letter-spacing:0}
.lw-am-submit{flex:0 0 auto;height:26px;padding:0 10px;border:0;border-radius:6px;background:var(--a-text);color:var(--a-bg);font-family:inherit;font-size:12px;font-weight:600;line-height:1;cursor:pointer;transition:opacity .12s}
.lw-am-submit:hover{opacity:.85}
.lw-am-submit:disabled{opacity:.4;cursor:default}
.lw-am-note{margin-top:6px;color:var(--a-muted);font-size:11.5px;line-height:16px}
.lw-am-redeem .lw-acct-msg{margin-top:8px}
.lw-am-ledger{margin-top:4px;max-height:168px;overflow:auto}
.lw-am-row{display:flex;align-items:baseline;justify-content:space-between;gap:10px;padding:5px 0;font-size:12px}
.lw-am-row-note{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lw-am-row-time{margin-left:6px;color:var(--a-muted);font-size:11px}
.lw-am-row-amt{font-variant-numeric:tabular-nums;white-space:nowrap;color:var(--a-muted)}
.lw-am-row-amt.is-plus{color:var(--a-primary)}
.lw-am-empty{padding:4px 0;color:var(--a-muted);font-size:12px}
.lw-am-item{display:flex;align-items:center;gap:10px;width:100%;height:32px;padding:0 10px;border:0;border-radius:7px;background:none;color:var(--a-text);font-family:inherit;font-size:13px;font-weight:500;line-height:1;text-align:left;text-decoration:none;cursor:pointer;transition:background .1s}
.lw-am-item:hover,.lw-am-item:focus-visible{background:var(--a-soft);outline:none}
.lw-am-item svg{flex:0 0 auto;color:var(--a-muted)}
.lw-am-item .lw-am-kbd{margin-left:auto;color:var(--a-muted)}
.lw-am-item.is-danger:hover{color:var(--a-err)}
.lw-am-item.is-danger:hover svg{color:var(--a-err)}
/* ---------- split sign-in page (signed out) ---------- */
.lw-gate{--g-ink:var(--lw-ink-cool-900,#16181d);--g-muted:var(--lw-slate-cool-500,#6b7280);--g-line:var(--lw-cool-gray-180,#e6e7eb);--g-bg:var(--lw-white,#fff);--g-brand:var(--lw-green-teal-700,#1f7a55);position:fixed;inset:0;z-index:2147482000;display:grid;grid-template-columns:1.1fr 1fr;background:var(--g-bg);color:var(--g-ink);font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif}
.dark .lw-gate{--g-ink:var(--lw-cool-gray-60,#f1f5f9);--g-muted:var(--lw-cool-gray-350,#94a3b8);--g-line:var(--lw-ink-cool-700,#334155);--g-bg:var(--lw-ink-cool-950,#11151c);--g-brand:var(--lw-green-teal-600,#2e9a6d)}
.lw-gate-art{position:relative;overflow:hidden;background:#0f1115}
.lw-gate-wall{position:absolute;inset:-90px;display:grid;grid-template-columns:repeat(4,1fr);align-items:start;gap:12px;padding:12px;transform:rotate(-8deg) scale(1.12)}
.lw-gate-col{display:flex;flex-direction:column;gap:12px;animation:lw-gate-drift 90s linear infinite;will-change:transform;backface-visibility:hidden}
.lw-gate-col:nth-child(2){animation-duration:110s;animation-direction:reverse;margin-top:-140px}
.lw-gate-col:nth-child(3){animation-duration:100s;margin-top:-60px}
.lw-gate-col:nth-child(4){animation-duration:120s;animation-direction:reverse;margin-top:-200px}
@keyframes lw-gate-drift{from{transform:translate3d(0,0,0)}to{transform:translate3d(0,calc(-50% - 6px),0)}}
@media (prefers-reduced-motion:reduce){.lw-gate-col{animation:none}}
.lw-gate-tile{position:relative;width:100%;aspect-ratio:3/4;overflow:hidden;border-radius:12px;background:#1b1d22 center/cover no-repeat;box-shadow:0 10px 26px rgb(0 0 0 / .4)}
.lw-gate-tile img{display:block;width:100%;height:100%;object-fit:cover;opacity:0;transition:opacity .5s ease}
.lw-gate-tile img.is-in{opacity:1}
.lw-gate-shade{position:absolute;inset:0;background:radial-gradient(70% 55% at 50% 50%,rgb(10 11 14 / .72),rgb(10 11 14 / .3) 70%,rgb(10 11 14 / .5))}
.lw-gate-caption{position:absolute;left:10%;right:10%;top:50%;translate:0 -50%;color:#fff;text-align:center}
.lw-gate-brand{position:absolute;top:56px;left:50%;translate:-50% 0;z-index:1;display:flex;align-items:center;gap:10px;color:#fff;font-weight:600;font-size:15px}
.lw-gate-brand img,.lw-gate-mobile-brand img{width:34px;height:34px;padding:3px;border-radius:10px;background:#fff}
.lw-gate-caption h1{margin:0 0 16px;font-size:clamp(34px,3.4vw,48px);line-height:1.2;font-weight:650;letter-spacing:-.01em;color:#fff;text-shadow:0 4px 30px rgb(0 0 0 / .5)}
.lw-gate-caption p{margin:0;color:rgb(255 255 255 / .72);font-size:16px}
.lw-gate-tags{display:flex;flex-wrap:wrap;justify-content:center;gap:8px;margin-top:28px}
.lw-gate-tags span{padding:5px 10px;border:1px solid rgb(255 255 255 / .2);border-radius:999px;background:rgb(255 255 255 / .08);color:rgb(255 255 255 / .85);font-size:12px;backdrop-filter:blur(6px)}
.lw-gate-side{display:flex;flex-direction:column;align-items:center;justify-content:center;padding:40px;overflow:auto}
.lw-gate-slot{width:100%;max-width:360px}
.lw-gate-side{position:relative;isolation:isolate}
.lw-gate-kitties{position:absolute;inset:0;z-index:-1;overflow:hidden;pointer-events:none}
.lw-gate-kitties i{position:absolute;display:block;background:linear-gradient(140deg,var(--g-kitty-a),var(--g-kitty-b));-webkit-mask:url(./kitty.png) center/contain no-repeat;mask:url(./kitty.png) center/contain no-repeat}
.lw-gate{--g-kitty-a:#fce7f3;--g-kitty-b:#ede9fe}
.dark .lw-gate{--g-kitty-a:#3a2232;--g-kitty-b:#2a2540}
.lw-gate-mobile-brand{display:none;align-items:center;gap:10px;margin-bottom:28px;font-weight:600;font-size:15px}
.lw-gate .lw-entry-acct,.lw-gate .lw-entry-acct.is-guest{--a-bg:var(--g-bg);--a-text:var(--g-ink);--a-muted:var(--g-muted);--a-border:var(--g-line);--a-primary:var(--g-ink);--a-primary-hover:var(--g-ink);margin:0;padding:0;border:0;border-radius:0;background:transparent}
.lw-gate .lw-entry-acct .lw-entry-title{margin:0 0 6px;font-size:26px;font-weight:650;letter-spacing:-.01em}
.lw-gate .lw-entry-acct .lw-entry-sub{margin:0 0 26px;font-size:14px}
.lw-gate .lw-entry-acct .lw-acct-tabs{display:flex;gap:22px;padding:0;margin:0 0 22px;border-radius:0;border-bottom:1px solid var(--g-line);background:none}
.lw-gate .lw-entry-acct .lw-acct-tab{height:auto;padding:0 0 10px;margin-bottom:-1px;border-radius:0;border-bottom:2px solid transparent;font-size:14px;font-weight:500;box-shadow:none}
.lw-gate .lw-entry-acct .lw-acct-tab[aria-selected="true"]{background:none;color:var(--g-ink);border-color:var(--g-ink);box-shadow:none}
.lw-gate .lw-entry-acct .lw-acct-form{gap:16px}
.lw-gate .lw-entry-acct .lw-acct-label{gap:6px;color:var(--g-ink);font-size:13px;font-weight:500}
.lw-gate .lw-entry-acct .lw-acct-input{height:44px;padding:0 14px;border-radius:10px;font-size:14.5px}
.lw-gate .lw-entry-acct .lw-acct-input:focus{border-color:var(--g-ink);box-shadow:0 0 0 4px rgb(22 24 29 / .06)}
.lw-gate .lw-entry-acct .lw-acct-btn{height:46px;border-radius:10px;background:var(--g-ink);color:var(--g-bg);font-size:15px;font-weight:600}
.lw-gate .lw-entry-acct .lw-acct-btn:hover{opacity:.9}
.lw-gate .lw-entry-acct .lw-acct-btn.is-ghost{height:44px;background:transparent;color:var(--g-ink);border:1px solid var(--g-line);font-size:13px}
.lw-gate .lw-entry-acct .lw-acct-forgot{align-self:center;margin-top:-4px;color:var(--g-muted)}
.lw-gate-center{text-align:center}
.lw-gate-remember{display:flex;flex-direction:column;align-items:center;gap:4px;margin:0 0 6px}
.lw-gate-remember img{width:72px;height:72px;margin-bottom:10px;border-radius:50%;object-fit:cover;box-shadow:0 0 0 4px var(--g-bg),0 0 0 5px var(--g-line)}
.lw-gate-remember b{font-size:20px;font-weight:650}
.lw-gate-remember small{max-width:100%;overflow:hidden;color:var(--g-muted);font-size:13px;text-overflow:ellipsis;white-space:nowrap}
.lw-gate-face{position:relative;display:block;padding:0;border:0;border-radius:50%;background:none;cursor:default}
button.lw-gate-face{cursor:pointer;transition:transform .2s}
button.lw-gate-face:hover{transform:scale(1.04)}
.lw-gate-face img{display:block}
.lw-gate-face::after{content:"";position:absolute;inset:-7px;border-radius:50%;background:conic-gradient(from 0deg,transparent 0 55%,#f472b6 75%,#8b5cf6 100%);-webkit-mask:radial-gradient(circle,transparent 62%,#000 63%);mask:radial-gradient(circle,transparent 62%,#000 63%);opacity:0;transition:opacity .3s}
.lw-gate-signing-text{display:block;max-height:0;overflow:hidden;color:var(--g-muted);font-size:13px;font-style:normal;opacity:0;transition:max-height .4s ease,opacity .3s ease,margin .4s ease}
.lw-gate-rest{display:grid;grid-template-rows:1fr;transition:grid-template-rows .5s cubic-bezier(.4,0,.2,1),opacity .3s ease}
.lw-gate-rest>div{min-height:0;overflow:hidden}
.lw-gate-quick .lw-gate-remember img{transition:transform .5s cubic-bezier(.4,0,.2,1)}
.lw-gate-quick.is-signing .lw-gate-rest{grid-template-rows:0fr;opacity:0;pointer-events:none}
.lw-gate-quick.is-signing .lw-gate-remember img{transform:scale(1.15)}
.lw-gate-quick.is-signing .lw-gate-face::after{opacity:1;animation:lw-gate-spin 1s linear infinite}
.lw-gate-quick.is-signing .lw-gate-signing-text{max-height:24px;margin-top:10px;opacity:1}
.lw-gate-quick.is-signing button.lw-gate-face{pointer-events:none}
@keyframes lw-gate-spin{to{transform:rotate(360deg)}}
.lw-gate-me.is-entering{animation:lw-gate-enter .5s cubic-bezier(.2,.7,.2,1) both}
@keyframes lw-gate-enter{from{opacity:0;transform:translateY(10px) scale(.98)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){.lw-gate-rest,.lw-gate-quick .lw-gate-remember img,.lw-gate-signing-text{transition:none}.lw-gate-quick.is-signing .lw-gate-face::after{animation:none}.lw-gate-me.is-entering{animation:none}}
.lw-gate-other{display:block;width:100%;margin-top:14px;padding:10px;border:1px dashed var(--g-line);border-radius:10px;background:none;color:var(--g-muted);font:inherit;font-size:13px;cursor:pointer}
.lw-gate-other:hover{color:var(--g-ink);border-color:var(--g-muted)}
.lw-gate .lw-gate-forget{display:block;margin:12px auto 0;color:var(--g-muted);font-size:12px}
.lw-gate-me-avatar{display:block;width:72px;height:72px;margin:0 auto 16px;border-radius:50%;object-fit:cover;box-shadow:0 0 0 4px var(--g-bg),0 0 0 5px var(--g-line)}
.lw-gate-admin{color:var(--g-brand);font-weight:600}
.lw-gate-balance{display:flex;align-items:center;justify-content:space-between;padding:12px 14px;margin:0 0 16px;border:1px solid var(--g-line);border-radius:12px;font-size:14px;text-align:left}
.lw-gate-balance b{font-size:18px;font-weight:650;font-variant-numeric:tabular-nums}
.lw-gate-balance-acts{display:flex;gap:14px;font-size:13px}
.lw-gate-balance-acts a{color:var(--g-brand);font-weight:600;text-decoration:none}
.lw-gate .lw-entry-redeem{margin:-6px 0 16px}
.lw-gate-projects{display:grid;gap:10px}
.lw-gate-me .lw-acct-msg{margin-top:12px}
.lw-gate-links{display:flex;justify-content:center;gap:20px;margin-top:22px;font-size:13px}
.lw-gate-links a{color:var(--g-ink);text-decoration:none;font-weight:500}
.lw-gate-links a:hover{text-decoration:underline}
.lw-gate-foot{margin:24px 0 0;color:var(--g-muted);font-size:12.5px;text-align:center}
.lw-gate-foot a{color:var(--g-brand);font-weight:600;text-decoration:none}
.lw-gate-foot a:hover{text-decoration:underline}
@media (max-width:860px){.lw-gate{grid-template-columns:1fr}.lw-gate-art{display:none}.lw-gate-side{justify-content:flex-start;padding:48px 24px}.lw-gate-mobile-brand{display:flex}}
.lw-start .lw-acct{display:none}
.startup-entry{visibility:hidden}
.lw-gate-face-blank{display:block;width:72px;height:72px;border-radius:50%;background:var(--g-line)}
.lw-gate-checking .lw-gate-signing-text{transition:none}
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

  // 土豆 straight from the browser: the canvas asks to be charged before it sends a
  // generation, and refunded when 土豆 fails. The admin is never charged.
  globalThis.__lwDirectCharge = async (url, body) => {
    let result;
    try {
      result = await api("/direct/charge", { method: "POST", body: { url, body } });
    } catch (error) {
      if (/余额不足/.test(error.message)) window.dispatchEvent(new CustomEvent("lw-insufficient"));
      throw error;
    }
    // Users see their new balance; the admin sees the 土豆 site balance refresh.
    window.dispatchEvent(new CustomEvent("lw-balance-changed", { detail: { url } }));
    return result.ref || "";
  };
  globalThis.__lwDirectRefund = async (ref, reason) => {
    if (!ref) return;
    try {
      const result = await api("/direct/refund", { method: "POST", body: { ref, reason } });
      if (result.refunded > 0) window.dispatchEvent(new CustomEvent("lw-refunded", { detail: { amount: result.refunded } }));
    } catch (error) {
      console.error("土豆退款失败：", error.message);
    }
  };

  const SITE_SHORT = { tudou: "土豆", apimart: "Mart", grsai: "Grsai", runninghub: "RH", soon: "Soon" };

  // GPT Image 2.5 "official" mode is admin-only. The app bundle reads this flag
  // and the shared option list; the server refuses official requests from users.
  // Users and guests: keep the browser's developer tools shut (the 土豆 key lives in
  // this page). A determined user can still get around it; the owner accepted that.
  // The admin is never blocked.
  let devtoolsTimer = null;
  let devtoolsLocked = false;
  const DEVTOOLS_KEYS = new Set(["KeyI", "KeyJ", "KeyC"]);
  function blockDevtoolsKeys(event) {
    const mod = event.ctrlKey || event.metaKey;
    const opens = event.key === "F12"
      || (mod && (event.shiftKey || event.altKey) && DEVTOOLS_KEYS.has(event.code))
      || (mod && !event.shiftKey && !event.altKey && event.code === "KeyU");
    if (opens) { event.preventDefault(); event.stopPropagation(); }
  }
  function blockContextMenu(event) { event.preventDefault(); }
  function lockForDevtools() {
    if (devtoolsLocked) return;
    devtoolsLocked = true;
    globalThis.__lwTudouKey = "";
    document.documentElement.innerHTML = '<head><meta charset="utf-8"><title>老屋作坊</title></head>'
      + '<body style="margin:0;display:grid;place-items:center;height:100vh;font:16px -apple-system,PingFang SC,Microsoft YaHei,sans-serif;background:#f7f7f8;color:#18181b">'
      + '<div style="text-align:center"><p style="font-size:18px;font-weight:600;margin:0 0 8px">请关闭开发者工具</p><p style="margin:0;color:#71717a">关闭后刷新页面即可继续使用</p></div></body>';
  }
  function startDevtoolsGuard() {
    if (devtoolsTimer || devtoolsLocked) return;
    window.addEventListener("keydown", blockDevtoolsKeys, true);
    window.addEventListener("contextmenu", blockContextMenu, true);
    devtoolsTimer = setInterval(() => {
      // Paused here only while developer tools are open.
      const start = performance.now();
      debugger; // eslint-disable-line no-debugger
      if (performance.now() - start > 100) lockForDevtools();
    }, 1000);
  }
  function stopDevtoolsGuard() {
    clearInterval(devtoolsTimer);
    devtoolsTimer = null;
    window.removeEventListener("keydown", blockDevtoolsKeys, true);
    window.removeEventListener("contextmenu", blockContextMenu, true);
  }

  function applyRole(tries = 0) {
    const admin = user?.role === "admin";
    globalThis.__lwIsAdmin = admin;
    globalThis.__lwGptOfficial = admin;
    if (admin) stopDevtoolsGuard(); else startDevtoolsGuard();
    window.dispatchEvent(new Event("laowu-role"));
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

  // The last account signed in on this device, kept after sign-out so the sign-in page can offer it.
  const LAST_ACCOUNT_KEY = "lw-last-account";
  let useOtherAccount = false;
  let welcomeMotion = false; // fade the welcome panel in right after a one-click sign-in
  function lastAccount() {
    try { const a = JSON.parse(localStorage.getItem(LAST_ACCOUNT_KEY) || "null"); return a && a.email ? a : null; } catch (_) { return null; }
  }
  function rememberAccount(u, deviceToken) {
    try {
      const prev = lastAccount();
      const keep = prev && prev.email === u.email ? prev.deviceToken || "" : "";
      localStorage.setItem(LAST_ACCOUNT_KEY, JSON.stringify({ email: u.email, name: u.displayName || u.email, avatar: String(u.avatar || "").length < 60000 ? u.avatar || "" : "", deviceToken: deviceToken || keep }));
    } catch (_) { /* storage blocked */ }
  }
  function forgetAccount() {
    const last = lastAccount();
    try { localStorage.removeItem(LAST_ACCOUNT_KEY); } catch (_) { /* storage blocked */ }
    if (last?.deviceToken) api("/device-forget", { method: "POST", body: { deviceToken: last.deviceToken } }).catch(() => {});
  }
  // One click on the remembered account: sign in with this device's token instead of a password.
  async function quickSignIn() {
    const last = lastAccount();
    if (!last?.deviceToken || busy) return;
    busy = true; message = null;
    // Animate on the page as it is (no repaint): fold away the rest, centre the avatar, show the ring.
    const box = entry?.querySelector(".lw-gate-quick");
    box?.classList.add("is-signing");
    const started = Date.now();
    try {
      const result = await api("/device-login", { method: "POST", body: { deviceToken: last.deviceToken } });
      await new Promise((r) => setTimeout(r, Math.max(0, 700 - (Date.now() - started)))); // let the motion finish
      rememberAccount(result.user, result.deviceToken);
      welcomeMotion = true;
      setUser(result.user);
      await loadLedger();
    } catch (error) {
      box?.classList.remove("is-signing");
      // The token is spent or revoked: keep the account but fall back to the password box.
      try { localStorage.setItem(LAST_ACCOUNT_KEY, JSON.stringify({ ...last, deviceToken: "" })); } catch (_) { /* storage blocked */ }
      message = { type: "error", text: error.message };
    } finally {
      busy = false; render();
    }
  }

  function setUser(next) {
    const sameUser = Boolean(user && next && user.id === next.id && user.role === next.role);
    user = next;
    if (next) { rememberAccount(next); useOtherAccount = false; }
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
    globalThis.__lwTudouKey = "";
    if (user) {
      // 土豆 is called straight from this browser with the site key (no relay, no COS).
      api("/tudou-key").then((k) => { globalThis.__lwTudouKey = k.apiKey || ""; }).catch(() => {});
    }
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

  // The relay reports money it gave back (failed generation); say so and show the new balance.
  let refundNoteTimer = null;
  function showNote(html, warn) {
    let note = document.querySelector(".lw-refund-note");
    if (!note) {
      note = document.createElement("div");
      note.className = "lw-refund-note";
      note.setAttribute("role", "status");
      document.body.appendChild(note);
    }
    note.innerHTML = html;
    note.classList.toggle("is-warn", Boolean(warn));
    note.classList.add("is-on");
    clearTimeout(refundNoteTimer);
    refundNoteTimer = setTimeout(() => note.classList.remove("is-on"), warn ? 8000 : 6000);
  }
  window.addEventListener("lw-refunded", (event) => {
    const amount = Number(event.detail?.amount);
    if (!user || !(amount > 0)) return;
    showNote(esc(`生成失败，本次费用 ${money(amount)} 已退回你的余额`));
    refresh();
  });
  window.addEventListener("lw-insufficient", () => {
    if (!user) return;
    showNote(`余额不足，没有扣费。当前余额 ${esc(money(user.balance))}，<a href="${BUY_URL}" target="_blank" rel="noopener noreferrer">购买兑换码</a>后在右上角充值`, true);
    refresh();
  });

  // The admin can change a user's balance from the admin page; pick that up when
  // the user comes back to the tab, and once a minute while the tab is visible.
  let lastBalanceCheck = 0;
  function recheckBalance(minGap) {
    if (!user || user.role === "admin" || document.visibilityState !== "visible") return;
    if (Date.now() - lastBalanceCheck < minGap) return;
    lastBalanceCheck = Date.now();
    refresh();
  }
  document.addEventListener("visibilitychange", () => recheckBalance(10_000));
  setInterval(() => recheckBalance(55_000), 60_000);

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
          ${passwordField(`name="password" autocomplete="${needsCode ? "new-password" : "current-password"}" required minlength="8" placeholder="至少 8 位"`)}
        </label>
        ${needsCode ? `<label class="lw-acct-label">确认${isReset ? "新" : ""}密码
          ${passwordField(`name="confirm" autocomplete="new-password" required minlength="8"`)}
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

  // Password boxes get an eye button so people can check what they typed.
  let showPassword = false;
  function passwordField(attrs) {
    return `<span class="lw-pw"><input class="lw-acct-input" type="${showPassword ? "text" : "password"}" ${attrs}>`
      + `<button type="button" class="lw-pw-eye" data-act="toggle-password" aria-label="${showPassword ? "隐藏密码" : "显示密码"}" aria-pressed="${showPassword}" title="${showPassword ? "隐藏密码" : "显示密码"}">${showPassword ? ICON.eyeOff : ICON.eye}</button></span>`;
  }

  const ICON = {
    eye: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>',
    eyeOff: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10.6 5.1A10.4 10.4 0 0 1 12 5c6.4 0 10 7 10 7a17.6 17.6 0 0 1-2.6 3.6M6.6 6.6C3.9 8.4 2 12 2 12s3.6 7 10 7a9.8 9.8 0 0 0 5.4-1.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/><path d="m2 2 20 20"/></svg>',
    pencil: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
    ticket: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9a3 3 0 0 0 0 6v3a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1v-3a3 3 0 0 0 0-6V6a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1Z"/><path d="M13 5v2M13 17v2M13 11v2"/></svg>',
    out: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/></svg>',
    admin: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/></svg>',
    camera: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3Z"/><circle cx="12" cy="13" r="3"/></svg>',
    image: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/></svg>',
    reset: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>',
    ext: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17 17 7"/><path d="M8 7h9v9"/></svg>',
  };

  function avatarImg() {
    const url = typeof globalThis.lwAvatarUrl === "function" ? globalThis.lwAvatarUrl(user) : "";
    return url ? `<img src="${esc(url)}" alt="" draggable="false">` : esc((user.displayName || user.email).slice(0, 1).toUpperCase());
  }

  // Crop to a centred square and shrink to 128px WebP before upload (well under the server's limit).
  async function shrinkAvatar(file) {
    const bitmap = await createImageBitmap(file);
    const side = Math.min(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 128;
    canvas.getContext("2d").drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, 128, 128);
    bitmap.close?.();
    for (const q of [0.85, 0.7, 0.55]) {
      const url = canvas.toDataURL("image/webp", q);
      if (url.startsWith("data:image/webp") && url.length < 50_000) return url;
    }
    return canvas.toDataURL("image/jpeg", 0.7);
  }

  async function saveAvatar(avatar) {
    busy = true;
    render();
    try {
      const r = await api("/avatar", { method: "POST", body: { avatar } });
      message = null;
      setUser(r.user);
    } catch (err) {
      message = { type: "error", text: err.message };
    } finally {
      busy = false;
      render();
    }
  }

  function pickAvatar() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/png,image/jpeg,image/webp";
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        await saveAvatar(await shrinkAvatar(file));
      } catch (_) {
        message = { type: "error", text: "这张图片读取失败，请换一张试试" };
        render();
      }
    });
    input.click();
  }

  function userView() {
    const isAdmin = user.role === "admin";
    const rows = ledgerItems.length
      ? ledgerItems.map((i) => `
        <div class="lw-am-row">
          <span class="lw-am-row-note" title="${esc(i.note || KIND_TEXT[i.kind] || i.kind)}">${esc(i.note || KIND_TEXT[i.kind] || i.kind)}<span class="lw-am-row-time">${esc(timeText(i.createdAt))}</span></span>
          <span class="lw-am-row-amt ${i.amount > 0 ? "is-plus" : ""}">${i.amount > 0 ? "+" : "−"}${esc(money(Math.abs(i.amount)).slice(1))}</span>
        </div>`).join("")
      : `<div class="lw-am-empty">还没有记录</div>`;
    const who = editingName
      ? `<form class="lw-am-rename" data-form="name"><input class="lw-am-field" name="displayName" maxlength="20" value="${esc(user.displayName || "")}" aria-label="昵称" autocomplete="off"><button class="lw-am-submit" type="submit">保存</button></form>`
      : `<div class="lw-am-id"><div class="lw-am-name"><span>${esc(user.displayName || user.email)}</span><button type="button" class="lw-am-icon" data-act="rename" title="改名" aria-label="改名">${ICON.pencil}</button></div><div class="lw-am-email">${esc(user.email)}</div></div>`;
    return `
      <div class="lw-am-sec lw-am-who"><button type="button" class="lw-am-avatar" data-act="avatar-pick" title="更换头像" aria-label="更换头像">${avatarImg()}<span class="lw-am-avatar-edit" aria-hidden="true">${ICON.camera}</span></button>${who}</div>
      ${isAdmin ? "" : `<div class="lw-am-sep"></div>
      <div class="lw-am-sec">
        <div class="lw-am-balance">
          <div class="lw-am-label">充值</div>
          <a class="lw-am-buy" href="${BUY_URL}" target="_blank" rel="noopener noreferrer">购买兑换码${ICON.ext}</a>
        </div>
        <form class="lw-am-redeem" data-form="redeem">
          <label class="lw-am-inputwrap" for="lw-acct-code">${ICON.ticket}
            <input class="lw-am-field" id="lw-acct-code" name="code" placeholder="输入兑换码充值" autocomplete="off" spellcheck="false" required aria-label="兑换码">
            <button class="lw-am-submit" type="submit" ${busy ? "disabled" : ""}>兑换</button>
          </label>
          ${msgView()}
          <div class="lw-am-note">按价格表扣费，生成失败会自动退回。</div>
        </form>
      </div>`}
      ${isAdmin ? `<div class="lw-am-sep"></div>
      <div class="lw-am-sec">
        <div class="lw-am-label">最近记录</div>
        <div class="lw-am-ledger">${rows}</div>
      </div>` : ""}
      <div class="lw-am-sep"></div>
      <div style="padding:4px 0">
        <button type="button" class="lw-am-item" data-act="avatar-pick">${ICON.image}更换头像</button>
        ${user.avatar ? `<button type="button" class="lw-am-item" data-act="avatar-reset">${ICON.reset}恢复默认头像</button>` : ""}
        ${isAdmin ? `<a class="lw-am-item" href="/admin.html" target="_blank" rel="noopener">${ICON.admin}管理后台<span class="lw-am-kbd">${ICON.ext}</span></a>` : ""}
        <a class="lw-am-item" href="./proxy-help.html" target="_blank" rel="noopener">${ICON.ext}开着代理出图慢？看设置方法</a>
        <button type="button" class="lw-am-item is-danger" data-act="logout">${ICON.out}退出登录</button>
      </div>`;
  }

  let host = null;

  function render() {
    if (!host) return;
    const chip = user
      ? `<button type="button" class="lw-acct-chip ${user.role === "admin" ? "is-admin" : `is-user ${user.balance < LOW_BALANCE ? "is-low" : ""}`}" data-act="toggle" aria-expanded="${open}" aria-label="账户：${esc(user.email)}${user.role === "admin" ? "" : `，余额 ${esc(money(user.balance))}`}">
           <span class="lw-acct-avatar" aria-hidden="true">${avatarImg()}</span>
           ${user.role === "admin"
             ? `<span class="lw-acct-admin-tag">管理员</span>`
             : `<span class="lw-acct-wallet" aria-hidden="true"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12V8H6a2 2 0 0 1 0-4h12v4"/><path d="M4 6v12a2 2 0 0 0 2 2h14v-4"/><path d="M18 12a2 2 0 0 0 0 4h4v-4z"/></svg></span><span class="lw-acct-bal">${esc(money(user.balance))}</span>`}
         </button>${user.role === "admin" ? siteBalanceStack() : ""}`
      : `<button type="button" class="lw-acct-chip is-guest" data-act="toggle" aria-expanded="${open}">${loaded ? `<span class="lw-acct-label-text">登录 / 注册</span><span aria-hidden="true" class="lw-acct-label-short">账户</span>` : "…"}</button>`;
    paint(host, `${chip}<div class="lw-acct-panel${user ? " is-menu" : ""}" role="dialog" aria-label="账户">${user ? userView() : guestView()}</div>`);
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
    if (!loaded) {
      // Shown for the moment the sign-in check takes: the remembered account if there is one.
      const last = gate && lastAccount();
      const pic = last && typeof globalThis.lwAvatarUrl === "function" ? globalThis.lwAvatarUrl({ email: last.email, avatar: last.avatar }) : "";
      return `<div class="lw-gate-quick is-signing lw-gate-checking"><div class="lw-gate-center"><div class="lw-gate-remember">
          <span class="lw-gate-face">${pic ? `<img src="${esc(pic)}" alt="">` : `<span class="lw-gate-face-blank"></span>`}</span>
          ${last ? `<b>${esc(last.name)}</b><small>${esc(last.email)}</small>` : ""}<em class="lw-gate-signing-text">正在检查登录状态…</em>
        </div></div></div>`;
    }
    if (!user && gate && mode === "login" && !useOtherAccount && lastAccount()) {
      const last = lastAccount();
      const pic = typeof globalThis.lwAvatarUrl === "function" ? globalThis.lwAvatarUrl({ email: last.email, avatar: last.avatar }) : "";
      return `<div class="lw-gate-quick">
        <div class="lw-gate-center">
        <div class="lw-gate-remember">${last.deviceToken ? `<button type="button" class="lw-gate-face" data-act="quick-login" title="点击登录" aria-label="以 ${esc(last.name)} 登录">` : `<span class="lw-gate-face">`}${pic ? `<img src="${esc(pic)}" alt="">` : ""}${last.deviceToken ? "</button>" : "</span>"}<b>${esc(last.name)}</b><small>${esc(last.email)}</small><em class="lw-gate-signing-text">正在登录…</em></div>
        </div>
        <div class="lw-gate-rest"><div>
        <p class="lw-entry-sub lw-gate-center">${last.deviceToken ? "点击头像或下面的按钮，直接进入你的画布" : "输入密码，继续使用这个账号"}</p>
        ${last.deviceToken ? `<div class="lw-acct-form">${msgView()}<button class="lw-acct-btn" type="button" data-act="quick-login" ${busy ? "disabled" : ""}>${busy ? "正在登录…" : "登录"}</button></div>` : `<form class="lw-acct-form" data-form="login" novalidate>
          <input type="hidden" name="email" value="${esc(last.email)}">
          ${passwordField(`name="password" autocomplete="current-password" required minlength="8" placeholder="输入密码" aria-label="密码" autofocus`)}
          ${msgView()}
          <button class="lw-acct-btn" type="submit" ${busy ? "disabled" : ""}>${busy ? "请稍候…" : "登录"}</button>
          <button type="button" class="lw-acct-linkbtn lw-acct-forgot" data-act="mode-reset">忘记密码？</button>
        </form>`}
        <button type="button" class="lw-gate-other" data-act="use-other">使用其他账号</button>
        <button type="button" class="lw-acct-linkbtn lw-gate-forget" data-act="forget-account">在这台设备上移除这个账号</button>
        <p class="lw-gate-foot">还没有算力？<a href="${BUY_URL}" target="_blank" rel="noopener noreferrer">购买兑换码</a>，登录后在右上角充值</p>
        </div></div></div>`;
    }
    if (user && gate) {
      const isAdmin = user.role === "admin";
      const opening = lastProjectState.startsWith("true");
      const projectError = lastProjectState.split("|").slice(1).join("|");
      const enter = welcomeMotion ? " is-entering" : "";
      welcomeMotion = false;
      return `<div class="lw-gate-me lw-gate-center${enter}">
          <img class="lw-gate-me-avatar" src="${esc(globalThis.lwAvatarUrl ? globalThis.lwAvatarUrl(user) : "")}" alt="">
          <h2 class="lw-entry-title">欢迎回来，${esc(user.displayName || user.email)}</h2>
          <p class="lw-entry-sub">${esc(user.email)}${isAdmin ? ' · <span class="lw-gate-admin">管理员</span>' : ""}</p>
          ${isAdmin ? "" : `<div class="lw-gate-balance"><span>余额 <b>${esc(money(user.balance))}</b></span><span class="lw-gate-balance-acts"><a href="${BUY_URL}" target="_blank" rel="noopener noreferrer">购买</a><button type="button" class="lw-acct-linkbtn" data-act="entry-redeem" aria-expanded="${entryRedeemOpen}">充值</button></span></div>
          ${entryRedeemOpen ? `<form class="lw-acct-form lw-entry-redeem" data-form="redeem"><div class="lw-acct-row"><input class="lw-acct-input" name="code" aria-label="兑换码" placeholder="输入兑换码" autocomplete="off" spellcheck="false" required><button class="lw-acct-btn" type="submit" ${busy ? "disabled" : ""}>兑换</button></div>${msgView()}</form>` : ""}`}
          <div class="lw-gate-projects">
            <button type="button" class="lw-acct-btn" data-act="project-blank" ${opening ? "disabled" : ""}>${opening ? "正在打开…" : "新建空白工程"}</button>
            <button type="button" class="lw-acct-btn is-ghost" data-act="project-import" ${opening ? "disabled" : ""}>打开已有工程</button>
          </div>
          ${projectError ? `<div class="lw-acct-msg is-error" role="alert">${esc(projectError)}</div>` : ""}
          <div class="lw-gate-links">${isAdmin ? `<a href="/admin.html" target="_blank" rel="noopener">管理后台 ↗</a>` : ""}<button type="button" class="lw-acct-linkbtn" data-act="logout">退出登录</button></div>
        </div>`;
    }
    if (!user) {
      return `<h2 class="lw-entry-title">${mode === "register" ? "创建账号" : mode === "reset" ? "找回密码" : "欢迎回来"}</h2>
        <p class="lw-entry-sub">${mode === "reset" ? "输入注册时用的邮箱，收到验证码后设置新密码" : mode === "register" ? "用邮箱注册，建议使用 QQ / 163 邮箱接收验证码" : "登录后继续你的画布工程"}</p>${guestView()}
        <p class="lw-gate-foot">还没有算力？<a href="${BUY_URL}" target="_blank" rel="noopener noreferrer">购买兑换码</a>，登录后在右上角充值</p>`;
    }
    return `<div class="lw-entry-user">
        <span class="lw-acct-avatar" aria-hidden="true">${avatarImg()}</span>
        <span class="lw-entry-user-name" title="${esc(user.email)}">${esc(user.email)}</span>
        ${user.role === "admin"
          ? `<span class="lw-entry-user-bal lw-acct-sites">${siteBalancesInline()}</span>`
          : `<span class="lw-entry-user-bal">余额 <b>${esc(money(user.balance))}</b></span>`}
        <span class="lw-entry-spacer"></span>
        ${user.role === "admin" ? "" : `<a class="lw-entry-mini lw-entry-buy" href="${BUY_URL}" target="_blank" rel="noopener noreferrer">购买</a>
        <button type="button" class="lw-entry-mini" data-act="entry-redeem" aria-expanded="${entryRedeemOpen}">充值</button>`}
        ${user.role === "admin" ? `<a class="lw-entry-mini" style="display:inline-grid;place-items:center;text-decoration:none" href="/admin.html" target="_blank" rel="noopener">管理后台</a>` : ""}
        <button type="button" class="lw-entry-mini" data-act="logout">退出</button>
      </div>
      ${entryRedeemOpen ? `<form class="lw-acct-form lw-entry-redeem" data-form="redeem">
        <div class="lw-acct-row">
          <input class="lw-acct-input" name="code" aria-label="兑换码" placeholder="输入兑换码 LW-XXXX-XXXX-XXXX-XXXX" autocomplete="off" spellcheck="false" required>
          <button class="lw-acct-btn" type="submit" ${busy ? "disabled" : ""}>兑换</button>
        </div>${msgView()}</form>` : ""}`;
  }

  // Signed-out visitors see a full-screen split sign-in page (artwork wall + form)
  // over the start screen; the same entry card and forms live in its right half.
  let gate = null;
  let lastProjectState = "";
  // Soft Kitty silhouettes scattered around the form: [left %, top %, size px, rotation, opacity].
  const GATE_KITTIES = [[6, 8, 92, -14, 1], [78, 5, 64, 12, 0.9], [86, 38, 110, -8, 0.8], [4, 62, 70, 10, 0.9], [70, 80, 84, -16, 1], [18, 88, 52, 18, 0.8], [44, 3, 46, 6, 0.75]];
  // Showcase pictures for the sign-in page, shown as a tilted, slowly drifting wall.
  const GATE_SLIDES = ["01-perfume", "09-watch", "02-portrait", "10-jewelry", "03-architecture", "11-interior", "04-lake", "12-dancer", "05-tea", "13-dunes", "06-sneaker", "14-dessert", "07-city", "15-menswear", "08-ikebana", "16-bloom"];
  function gateArt() {
    // Each column lists the pictures twice so the drift can loop without a seam.
    // Each column shows 8 different pictures; with 4 columns every picture appears twice.
    const col = (shift) => {
      const order = [...GATE_SLIDES.slice(shift), ...GATE_SLIDES.slice(0, shift)].filter((_, i) => i % 2 === 0);
      return `<div class="lw-gate-col">${[...order, ...order].map((name) => `<div class="lw-gate-tile"><img src="./login/${name}.jpg?v=4" alt="" decoding="async" draggable="false" onload="this.classList.add('is-in')"></div>`).join("")}</div>`;
    };
    return `<section class="lw-gate-art" aria-hidden="true">
        <div class="lw-gate-wall">${col(0)}${col(1)}${col(4)}${col(7)}</div>
        <div class="lw-gate-shade"></div>
        <div class="lw-gate-brand"><img src="./kitty.png" alt="">老屋作坊</div>
        <div class="lw-gate-caption">
          <h1>无限画布 无限创作</h1>
          <p>文生图、图生图、多图参考与局部修改，在同一张画布上完成。</p>
          <div class="lw-gate-tags"><span>Nano Banana Pro</span><span>GPT Image 2.5</span><span>最高 4K</span><span>失败自动退回</span></div>
        </div>
      </section>`;
  }
  function gateSide() {
    if (!gate) {
      gate = document.createElement("div");
      gate.className = "lw-gate";
      gate.innerHTML = `${gateArt()}<main class="lw-gate-side"><div class="lw-gate-kitties" aria-hidden="true">${GATE_KITTIES.map(([x, y, size, rot, op]) => `<i style="left:${x}%;top:${y}%;width:${size}px;height:${size}px;rotate:${rot}deg;opacity:${op}"></i>`).join("")}</div><div class="lw-gate-mobile-brand"><img src="./kitty.png" alt="">老屋作坊</div><div class="lw-gate-slot"></div></main>`;
      document.body.appendChild(gate);
    }
    return gate.querySelector(".lw-gate-slot");
  }

  function renderEntry(force) {
    const workspace = document.querySelector(".startup-entry-workspace");
    const screen = workspace && workspace.closest(".startup-entry");
    document.documentElement.classList.toggle("lw-start", Boolean(workspace));
    const gated = Boolean(workspace);
    if (!gated && gate) { gate.remove(); gate = null; }
    if (!workspace) { entry = null; return; }
    const target = gated ? gateSide() : workspace;
    let created = false;
    if (!entry) {
      created = true;
      entry = document.createElement("div");
      entry.className = "lw-entry-acct";
      entry.addEventListener("click", onClick);
      entry.addEventListener("submit", onSubmit);
    }
    if (!target.contains(entry)) { target.appendChild(entry); created = true; }
    screen.classList.toggle("lw-gated", gated);
    entry.classList.toggle("is-guest", !user);
    // Mirror the start screen's own folder state (opening / error) into the page on top of it.
    const projectError = screen.querySelector(".startup-entry-error")?.textContent || "";
    const projectBusy = Boolean(screen.querySelector(".startup-entry-primary.ant-btn-loading"));
    const projectState = `${projectBusy}|${projectError}`;
    if (projectState !== lastProjectState) { lastProjectState = projectState; force = true; }
    if (force || created) paint(entry, entryView());
  }

  const TRANSIENT = '.canvas-image-viewer, .ant-modal-wrap, .laowu-canvas-viewport > .origin-top-left, [data-notification-index], [class*="notification"], [role="alert"], [role="status"], .lw-refund-note';
  function placeChip() {
    if (!host || document.documentElement.classList.contains("lw-start")) return;
    // While hidden (image preview, settings) the corner holds that overlay's buttons; keep the last spot.
    if (getComputedStyle(host).display === "none") return;
    let right = 12;
    const y = 26;
    for (let x = window.innerWidth - 8; x > window.innerWidth - 420; x -= 24) {
      const el = document.elementsFromPoint(x, y).find((n) => !host.contains(n) && n !== document.body && n !== document.documentElement && getComputedStyle(n).pointerEvents !== "none");
      if (!el || el.closest(TRANSIENT)) continue; // canvas nodes and pop-up notices are not toolbar buttons
      const box = el.getBoundingClientRect();
      if (box.width > window.innerWidth * 0.6 || box.height > 120) continue; // canvas / background layers
      right = Math.max(right, window.innerWidth - box.left + 8);
      x = box.left;
    }
    if (host.style.right !== `${right}px`) host.style.right = `${right}px`;
  }

  // Measuring the top-right corner forces layout, so never do it in the same
  // frame as a DOM change (e.g. a dropdown opening): wait until things settle.
  let placeTimer = null;
  function placeChipLater() {
    clearTimeout(placeTimer);
    placeTimer = setTimeout(() => {
      if (typeof requestIdleCallback === "function") requestIdleCallback(placeChip, { timeout: 500 });
      else placeChip();
    }, 400);
  }

  let scheduled = false;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      renderEntry(false);
      placeChipLater();
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
    if (kind === "name") {
      try {
        const result = await api("/profile", { method: "POST", body: { displayName: String(data.displayName || "").trim() } });
        editingName = false;
        setUser({ ...user, ...result.user });
      } catch (error) {
        message = { type: "error", text: error.message };
        render();
      }
      return;
    }
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
        if (result.deviceToken) rememberAccount(result.user, result.deviceToken);
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
    else if (act === "toggle-password") {
      showPassword = !showPassword;
      document.querySelectorAll(".lw-pw").forEach((box) => {
        const input = box.querySelector("input");
        const eye = box.querySelector(".lw-pw-eye");
        if (input) input.type = showPassword ? "text" : "password";
        if (eye) {
          const label = showPassword ? "隐藏密码" : "显示密码";
          eye.innerHTML = showPassword ? ICON.eyeOff : ICON.eye;
          eye.setAttribute("aria-label", label);
          eye.setAttribute("aria-pressed", String(showPassword));
          eye.title = label;
        }
      });
      el.closest(".lw-pw")?.querySelector("input")?.focus();
    }
    else if (act === "avatar-pick") { pickAvatar(); }
    else if (act === "project-blank" || act === "project-import") {
      // The folder picker needs this click's user activation, so press the start screen's own button now.
      document.querySelector(`.startup-entry [data-project-action="${act === "project-blank" ? "blank" : "import"}"]`)?.click();
    }
    else if (act === "use-other") { useOtherAccount = true; message = null; render(); }
    else if (act === "quick-login") { quickSignIn(); }
    else if (act === "forget-account") { forgetAccount(); useOtherAccount = false; message = null; render(); }
    else if (act === "avatar-reset") { saveAvatar(""); }
    else if (act === "rename") { editingName = true; render(); host.querySelector('input[name="displayName"]')?.focus(); }

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
