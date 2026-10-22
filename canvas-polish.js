// Canvas finishing touches that live outside the app bundle:
// - an empty-canvas guide with example prompts
// - hover tips for the left toolbar and the bottom bar
// - a keyboard shortcut panel (press ?)
// - one look for pop-up messages, and the current channel shown on the
//   bottom-left switcher instead of the top-left label.
(function () {
  "use strict";

  const css = `
.canvas-site-current-label{display:none!important}
.canvas-site-switch-named{display:inline-flex!important;align-items:center;gap:7px;width:auto!important;min-width:0!important;color:var(--lw-ui-gray-900)!important;font-size:12.5px;font-weight:600}
.dark .canvas-site-switch-named{color:var(--lw-stone-100)!important}
.canvas-site-switch-dot{display:block;width:8px;height:8px;border-radius:50%;background:var(--site);box-shadow:0 0 0 3px color-mix(in srgb,var(--site) 18%,transparent)}
.canvas-site-switch-name{max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

.lw-tip{position:fixed;z-index:2147483100;padding:6px 10px;border-radius:8px;background:var(--lw-ink-cool-900);color:var(--lw-white);font:500 12px/1.3 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;white-space:nowrap;pointer-events:none;opacity:0;transform:translateX(-4px);transition:opacity .12s,transform .12s;box-shadow:0 6px 18px rgb(var(--lw-slate-900-rgb) / .2)}
.lw-tip.is-on{opacity:1;transform:none}
.lw-tip.is-above{transform:translateY(4px)}
.lw-tip.is-above.is-on{transform:none}
.lw-tip kbd{margin-left:8px;padding:1px 5px;border-radius:4px;background:rgb(var(--lw-white-rgb) / .16);font:inherit;font-size:11px}

.lw-empty{position:fixed;inset:0;z-index:30;display:grid;place-items:center;pointer-events:none}
.lw-empty-card{display:flex;flex-direction:column;align-items:center;max-width:560px;padding:0 24px;text-align:center;animation:lw-empty-in .5s cubic-bezier(.2,.7,.2,1) both}
@keyframes lw-empty-in{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
.lw-empty-card img{width:56px;height:56px;margin-bottom:16px;opacity:.9}
.lw-empty-card h2{margin:0 0 6px;color:var(--lw-ui-gray-900);font:650 20px/1.3 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif}
.lw-empty-card p{margin:0 0 20px;color:var(--lw-ui-gray-500);font:400 13.5px/1.5 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif}
.lw-empty-chips{display:flex;flex-wrap:wrap;justify-content:center;gap:8px;pointer-events:auto}
.lw-empty-chips button{max-width:250px;padding:8px 14px;border:1px solid var(--lw-ui-gray-200);border-radius:999px;background:var(--lw-white);color:var(--lw-ui-gray-700);font:500 12.5px/1.4 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;text-align:left;cursor:pointer;box-shadow:0 1px 2px rgb(var(--lw-slate-900-rgb) / .04);transition:border-color .15s,box-shadow .15s,transform .15s}
.lw-empty-chips button:hover{border-color:var(--lw-ui-gray-400);box-shadow:0 6px 16px rgb(var(--lw-slate-900-rgb) / .08);transform:translateY(-1px)}
.lw-empty-chips button span{margin-right:6px}
.lw-empty-hint{margin-top:18px;color:var(--lw-ui-gray-400);font:400 12px/1.4 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif}
.lw-empty-hint kbd{padding:1px 6px;border:1px solid var(--lw-ui-gray-200);border-radius:4px;font:inherit}
.dark .lw-empty-card h2{color:var(--lw-stone-100)}
.dark .lw-empty-card p,.dark .lw-empty-hint{color:var(--lw-stone-400)}
.dark .lw-empty-chips button{border-color:var(--lw-stone-700);background:var(--lw-stone-900);color:var(--lw-stone-200)}

.lw-keys{position:fixed;inset:0;z-index:2147483200;display:grid;place-items:center;background:rgb(var(--lw-black-rgb) / .35);backdrop-filter:blur(2px);animation:lw-keys-fade .15s ease both}
@keyframes lw-keys-fade{from{opacity:0}to{opacity:1}}
.lw-keys-card{width:min(520px,calc(100vw - 32px));max-height:calc(100vh - 64px);overflow:auto;padding:22px 24px;border:1px solid var(--lw-ui-gray-200);border-radius:16px;background:var(--lw-white);color:var(--lw-ui-gray-900);font:13px/1.5 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;box-shadow:0 24px 64px rgb(var(--lw-slate-900-rgb) / .25)}
.lw-keys-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px}
.lw-keys-head h2{margin:0;font-size:16px;font-weight:650}
.lw-keys-head button{border:0;background:none;color:var(--lw-ui-gray-500);font:inherit;cursor:pointer}
.lw-keys-group{margin-top:14px;color:var(--lw-ui-gray-500);font-size:12px;font-weight:600}
.lw-keys-row{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:7px 0;border-bottom:1px solid var(--lw-ui-gray-100)}
.lw-keys-row:last-child{border-bottom:0}
.lw-keys-row span:last-child{display:flex;gap:4px;flex-wrap:wrap;justify-content:flex-end}
.lw-keys kbd{min-width:22px;padding:2px 7px;border:1px solid var(--lw-ui-gray-200);border-bottom-width:2px;border-radius:6px;background:var(--lw-ui-gray-100);color:var(--lw-ui-gray-700);font:500 12px/1.4 -apple-system,BlinkMacSystemFont,sans-serif;text-align:center}
.dark .lw-keys-card{border-color:var(--lw-stone-700);background:var(--lw-stone-900);color:var(--lw-stone-100)}
.dark .lw-keys-row{border-color:var(--lw-stone-800)}
.dark .lw-keys kbd{border-color:var(--lw-stone-700);background:var(--lw-stone-800);color:var(--lw-stone-200)}

.ant-message{top:16px!important}
.ant-message .ant-message-notice-wrapper{padding:10px 16px!important;border:1px solid var(--lw-ui-gray-200)!important;border-radius:12px!important;background:var(--lw-white)!important;color:var(--lw-ui-gray-900)!important;font-size:13px!important;font-weight:500;box-shadow:0 10px 30px rgb(var(--lw-slate-900-rgb) / .12)!important}
.ant-message .ant-message-notice-icon-error{color:var(--lw-red-600)!important}
.ant-message .ant-message-notice-icon-success{color:var(--lw-green-600)!important}
.ant-message .ant-message-notice-icon-warning{color:var(--lw-amber-500)!important}
.dark .ant-message .ant-message-notice-wrapper{border-color:var(--lw-stone-700)!important;background:var(--lw-stone-900)!important;color:var(--lw-stone-100)!important}
`;

  const style = document.createElement("style");
  style.id = "lw-canvas-polish";
  style.textContent = css;
  document.head.appendChild(style);

  const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  const MOD = isMac ? "⌘" : "Ctrl";
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // ---------- hover tips ----------
  const TIPS = {
    "素材": ["素材库"],
    "撤销 Ctrl / Cmd + Z": ["撤销", `${MOD} Z`],
    "保存": ["保存工程", `${MOD} S`],
    "深色": ["切换深色模式"],
    "浅色": ["切换浅色模式"],
    "设置": ["设置"],
    "打开小地图": ["打开小地图"],
    "关闭小地图": ["关闭小地图"],
  };
  const tip = document.createElement("div");
  tip.className = "lw-tip";
  tip.setAttribute("role", "tooltip");
  let tipFor = null;
  function tipText(button) {
    const label = button.getAttribute("aria-label") || "";
    if (label.startsWith("选择站点")) return ["切换渠道"];
    return TIPS[label] || (label ? [label] : null);
  }
  document.addEventListener("pointerover", (event) => {
    const button = event.target.closest?.("button");
    const zone = button && (button.closest(".pointer-events-auto.flex.w-14.flex-col") ? "left" : button.closest(".flex.h-11.items-center.overflow-hidden.rounded-full") ? "bottom" : null);
    if (!zone) { if (tipFor && !tipFor.contains(event.target)) hideTip(); return; }
    const text = tipText(button);
    if (!text) return;
    tipFor = button;
    tip.innerHTML = `${esc(text[0])}${text[1] ? `<kbd>${esc(text[1])}</kbd>` : ""}`;
    const r = button.getBoundingClientRect();
    tip.classList.toggle("is-above", zone === "bottom");
    tip.classList.add("is-on");
    const t = tip.getBoundingClientRect();
    if (zone === "left") { tip.style.left = `${r.right + 10}px`; tip.style.top = `${r.top + r.height / 2 - t.height / 2}px`; }
    else { tip.style.left = `${Math.max(8, r.left + r.width / 2 - t.width / 2)}px`; tip.style.top = `${r.top - t.height - 10}px`; }
  });
  function hideTip() { tipFor = null; tip.classList.remove("is-on"); }
  document.addEventListener("pointerdown", hideTip, true);

  // ---------- empty-canvas guide ----------
  const EXAMPLES = [
    ["🐱", "一只橘猫趴在洒满阳光的窗台上，胶片质感，温暖柔和"],
    ["🧴", "极简香水产品图，黑色大理石台面，金色轮廓光，高级感"],
    ["🌃", "赛博朋克风格的雨夜街道，霓虹灯倒影，电影感构图"],
    ["🏞️", "水彩风格的江南古镇，清晨薄雾，小桥流水"],
  ];
  let empty = null;
  function renderEmpty() {
    const onCanvas = document.querySelector(".laowu-canvas-viewport");
    const hasNodes = document.querySelector("[data-node-id]");
    const covered = document.querySelector(".lw-gate, .canvas-image-viewer");
    const show = Boolean(onCanvas && !hasNodes && !covered && typeof globalThis.__lwStartFromPrompt === "function");
    if (!show) { empty?.remove(); empty = null; return; }
    if (empty) return;
    empty = document.createElement("div");
    empty.className = "lw-empty";
    empty.innerHTML = `<div class="lw-empty-card">
        <img src="./kitty.png" alt="">
        <h2>开始你的第一张图</h2>
        <p>双击画布任意位置新建节点，或者把图片拖进来。也可以从下面的示例开始：</p>
        <div class="lw-empty-chips">${EXAMPLES.map(([icon, text]) => `<button type="button" data-prompt="${esc(text)}"><span>${icon}</span>${esc(text)}</button>`).join("")}</div>
        <div class="lw-empty-hint">按 <kbd>?</kbd> 查看全部快捷键</div>
      </div>`;
    empty.addEventListener("click", (event) => {
      const chip = event.target.closest("[data-prompt]");
      if (chip) globalThis.__lwStartFromPrompt?.(chip.dataset.prompt);
    });
    document.body.appendChild(empty);
  }

  // ---------- keyboard shortcut panel ----------
  const KEYS = [
    ["画布", [
      ["新建节点", ["双击空白处"]],
      ["框选多个节点", ["在空白处拖动"]],
      ["全选", [MOD, "A"]],
      ["取消选择 / 关闭面板", ["Esc"]],
    ]],
    ["编辑", [
      ["撤销", [MOD, "Z"]],
      ["重做", [MOD, "⇧", "Z"]],
      ["复制节点", [MOD, "C"]],
      ["粘贴节点", [MOD, "V"]],
      ["拖出一份副本", [isMac ? "⌥" : "Alt", "拖动节点"]],
      ["删除选中", ["Delete"]],
    ]],
    ["整理", [
      ["把选中的图片排成网格", ["Q"]],
      ["把选中的节点打包成分组", [isMac ? "⌥" : "Alt", "G"]],
    ]],
    ["工程", [
      ["保存工程", [MOD, "S"]],
      ["打开这个面板", ["?"]],
    ]],
  ];
  let keys = null;
  function toggleKeys(force) {
    const open = force ?? !keys;
    if (!open) { keys?.remove(); keys = null; return; }
    if (keys) return;
    keys = document.createElement("div");
    keys.className = "lw-keys";
    keys.innerHTML = `<div class="lw-keys-card" role="dialog" aria-label="快捷键">
        <div class="lw-keys-head"><h2>快捷键</h2><button type="button" data-close>关闭 Esc</button></div>
        ${KEYS.map(([group, rows]) => `<div class="lw-keys-group">${esc(group)}</div>${rows.map(([what, combo]) => `<div class="lw-keys-row"><span>${esc(what)}</span><span>${combo.map((k) => `<kbd>${esc(k)}</kbd>`).join("")}</span></div>`).join("")}`).join("")}
      </div>`;
    keys.addEventListener("click", (event) => {
      if (event.target === keys || event.target.closest("[data-close]")) toggleKeys(false);
    });
    document.body.appendChild(keys);
  }
  window.addEventListener("keydown", (event) => {
    if (keys && event.key === "Escape") { event.preventDefault(); event.stopPropagation(); toggleKeys(false); return; }
    const t = event.target;
    const typing = t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t?.isContentEditable;
    if (!typing && event.key === "?" && !event.metaKey && !event.ctrlKey && document.querySelector(".laowu-canvas-viewport")) {
      event.preventDefault();
      toggleKeys();
    }
  }, true);

  // This script runs from <head>; attach to the page once <body> exists.
  function start() {
  document.body.appendChild(tip);
  let pending = false;
  new MutationObserver(() => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => { pending = false; renderEmpty(); if (tipFor && !document.contains(tipFor)) hideTip(); });
  }).observe(document.body, { childList: true, subtree: true });
  // The canvas registers __lwStartFromPrompt a moment after its last DOM change; check again shortly.
  setInterval(renderEmpty, 1000);
  renderEmpty();
  }
  if (document.body) start();
  else document.addEventListener("DOMContentLoaded", start, { once: true });
})();
