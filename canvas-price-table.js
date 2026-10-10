/* Canvas price table. The app bundle can provide live rows through
 * window.__vinsenPriceBridge; this module only owns presentation. */
(function () {
  "use strict";

  const DEFAULT_FX_RATE = 6.7;
  const FX_STORAGE_KEY = "vinsen-canvas-price-fx-rate";
  const BRIDGE_NAME = "__vinsenPriceBridge";


  const css = `
.canvas-price-table-shell{overflow:visible !important}.canvas-price-table-divider{display:inline-block;width:1px;height:24px;flex:0 0 auto;margin:0 4px;background:var(--canvas-price-table-divider,rgba(148,163,184,.32))}
.canvas-price-table-host{position:relative;z-index:51;display:inline-flex;flex:0 0 auto;align-items:center;pointer-events:auto;font-family:inherit}
.canvas-price-table-toggle{display:grid;width:36px;min-width:36px;height:36px;place-items:center;padding:0;border:0;border-radius:999px;background:transparent;color:#312e81;cursor:pointer;transition:background-color .15s,color .15s}
.canvas-price-table-toggle:hover{background:rgba(99,102,241,.12);color:#4338ca}
.canvas-price-table-toggle svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-linecap:round;stroke-linejoin:round;stroke-width:1.8}
.canvas-price-table-panel{position:absolute;left:0;bottom:calc(100% + 10px);display:none;width:min(500px,calc(100vw - 24px));max-height:min(72vh,620px);overflow:auto;padding:14px;border:1px solid rgba(148,163,184,.32);border-radius:16px;background:rgba(255,255,255,.98);color:#292524;box-shadow:0 18px 50px rgba(15,23,42,.18);backdrop-filter:blur(14px)}
.canvas-price-table-host.is-open .canvas-price-table-panel{display:block}
.canvas-price-table-heading{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:2px;font-size:14px;font-weight:800;letter-spacing:.01em}.canvas-price-table-subtitle{margin-bottom:12px;color:#78716c;font-size:10px;line-height:1.4}.canvas-price-table-fx{display:flex;align-items:center;gap:6px;white-space:nowrap;color:#57534e;font-size:10px;font-weight:600}.canvas-price-table-fx input{width:48px;height:25px;padding:0 6px;border:1px solid rgba(99,102,241,.35);border-radius:7px;background:#fff;color:#292524;text-align:right;font:600 11px inherit}.canvas-price-table-fx button{height:25px;padding:0 7px;border:0;border-radius:7px;background:#eef2ff;color:#4338ca;font:700 10px inherit;cursor:pointer}.canvas-price-table-fx button:hover{background:#e0e7ff}
.canvas-price-table-group{margin-top:11px;overflow:hidden;border:1px solid rgba(148,163,184,.25);border-radius:12px;background:rgba(248,250,252,.66)}.canvas-price-table-group-head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 10px;background:linear-gradient(90deg,rgba(238,242,255,.92),rgba(248,250,252,.72));color:#3730a3;font-size:11px;font-weight:800}.canvas-price-table-group.provider-rh .canvas-price-table-group-head{background:linear-gradient(90deg,#eff6ff,#f8fafc);color:#1d4ed8}.canvas-price-table-group.provider-mart .canvas-price-table-group-head{background:linear-gradient(90deg,#f5f3ff,#fafafa);color:#6d28d9}.canvas-price-table-group.provider-soon .canvas-price-table-group-head{background:linear-gradient(90deg,#fff7ed,#fffbeb);color:#c2410c}.canvas-price-table-group.provider-tudou .canvas-price-table-group-head{background:linear-gradient(90deg,#ecfdf5,#f0fdfa);color:#047857}.canvas-price-table-group.provider-grsai .canvas-price-table-group-head{background:linear-gradient(90deg,#fff1f2,#fff7ed);color:#be123c}.canvas-price-table-count{color:#78716c;font-size:10px;font-weight:500}.canvas-price-table-grid{display:grid;grid-template-columns:minmax(0,1fr) repeat(3,54px);gap:7px;align-items:center}.canvas-price-table-grid-head{padding:7px 10px 5px;color:#a8a29e;font-size:9px;font-weight:700;text-align:right;text-transform:uppercase}.canvas-price-table-grid-head:first-child{text-align:left}.canvas-price-table-row{padding:8px 10px;border-top:1px solid rgba(148,163,184,.18);font-size:11px;line-height:1.3}.canvas-price-table-name{min-width:0}.canvas-price-table-model{display:block;overflow:hidden;font-weight:700;text-overflow:ellipsis;white-space:nowrap}.canvas-price-table-quality{display:block;color:#78716c;font-size:9px}.canvas-price-table-value{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums;font-size:10px;font-weight:700;color:#292524}.canvas-price-table-wide-note{grid-column:2 / span 3;color:#78716c;font-size:10px;text-align:center;white-space:nowrap}.canvas-price-table-note{display:block;color:#a8a29e;font-size:9px;font-weight:500}.canvas-price-table-empty{padding:14px 4px;color:#78716c;font-size:11px;text-align:center}.dark .canvas-price-table-divider{--canvas-price-table-divider:rgba(120,113,108,.5)}.dark .canvas-price-table-toggle{color:#c7d2fe}.dark .canvas-price-table-toggle:hover{background:rgba(99,102,241,.2);color:#e0e7ff}.dark .canvas-price-table-panel{background:rgba(28,25,23,.98);border-color:#44403c;color:#f5f5f4}.dark .canvas-price-table-subtitle,.dark .canvas-price-table-quality,.dark .canvas-price-table-count{color:#a8a29e}.dark .canvas-price-table-fx{color:#d6d3d1}.dark .canvas-price-table-fx input{background:#292524;border-color:#6366f1;color:#f5f5f4}.dark .canvas-price-table-fx button{background:#312e81;color:#e0e7ff}.dark .canvas-price-table-group{border-color:#44403c;background:rgba(41,37,36,.5)}.dark .canvas-price-table-group-head{background:linear-gradient(90deg,rgba(49,46,129,.55),rgba(41,37,36,.5));color:#c7d2fe}.dark .canvas-price-table-grid-head{color:#78716c}.dark .canvas-price-table-row{border-color:rgba(120,113,108,.35)}.dark .canvas-price-table-value{color:#f5f5f4}.dark .canvas-price-table-empty{color:#a8a29e}
@media(max-width:767px){.canvas-price-table-panel{width:calc(100vw - 16px);max-height:58vh}.canvas-price-table-grid{grid-template-columns:minmax(0,1fr) repeat(3,48px);gap:4px}}
`;

  function installStyles() {
    if (document.getElementById("canvas-price-table-style")) return;
    const style = document.createElement("style");
    style.id = "canvas-price-table-style";
    style.textContent = css;
    document.head.appendChild(style);
  }

  function bridgeSnapshot() {
    const bridge = window[BRIDGE_NAME];
    if (!bridge) return {};
    try {
      const snapshot = typeof bridge.getSnapshot === "function" ? bridge.getSnapshot() : bridge.snapshot;
      return snapshot && typeof snapshot === "object" ? snapshot : {};
    } catch (_) { return {}; }
  }

  function bridgeRows() {
    const bridge = window[BRIDGE_NAME];
    if (!bridge) return null;
    try {
      const rows = typeof bridge.getRows === "function" ? bridge.getRows() : bridge.rows;
      return Array.isArray(rows) && rows.length ? rows : null;
    } catch (_) { return null; }
  }

  function getFxRate() {
    try {
      const stored = Number.parseFloat(localStorage.getItem(FX_STORAGE_KEY));
      return Number.isFinite(stored) && stored > 0 ? stored : DEFAULT_FX_RATE;
    } catch (_) { return DEFAULT_FX_RATE; }
  }

  function setFxRate(value) {
    const rate = Number.parseFloat(value);
    if (!Number.isFinite(rate) || rate <= 0) return false;
    try { localStorage.setItem(FX_STORAGE_KEY, String(rate)); } catch (_) {}
    return true;
  }

  function formatPrice(row, quality) {
    const prices = row?.priceByQuality && typeof row.priceByQuality === "object" ? row.priceByQuality : null;
    const value = prices ? (prices[quality] ?? prices[String(quality).toLowerCase()]) : row?.price;
    return formatAmount(value, row?.currency);
  }

  function formatAmount(value, currency) {
    if (value == null || value === "") return "待确认";
    const amount = Number(value);
    if (!Number.isFinite(amount)) return "待确认";
    if (String(currency || "").toUpperCase() === "USD") {
      const cny = amount * getFxRate();
      return `¥${formatCny(cny)}`;
    }
    // Keep the normal two-decimal display, but retain a third decimal when
    // the live provider price contains one (for example Tudou's ¥0.088).
    return `¥${formatCny(amount)}`;
  }

  function formatCny(amount) {
    // Keep small provider prices such as ¥0.088 readable while avoiding
    // trailing zeroes for normal two-decimal prices.
    const decimals = Number(amount.toFixed(2)) === amount ? 2 : 3;
    return amount.toFixed(decimals);
  }

  function normalizeRow(row) {
    if (!row || typeof row !== "object") return null;
    return {
      site: String(row.site || row.providerName || row.provider || "").trim() || "当前站点",
      model: String(row.modelLabel || row.model || "").trim() || "当前模型",
      quality: String(row.qualityLabel || row.quality || row.resolution || "单张").trim(),
      price: row.price ?? row.amount ?? null,
      currency: String(row.currency || (row.usd != null ? "USD" : "CNY")).toUpperCase(),
      priceByQuality: row.priceByQuality,
      note: row.note || row.hint || "",
      fullWidthNote: row.fullWidthNote === true,
    };
  }

  function currentRow(snapshot) {
    if (!snapshot || snapshot.price == null) return null;
    return normalizeRow({
      site: snapshot.site || snapshot.providerName || snapshot.provider,
      model: snapshot.modelLabel || snapshot.model,
      quality: snapshot.qualityLabel || snapshot.quality || snapshot.resolution,
      price: snapshot.price,
      currency: snapshot.currency,
      note: snapshot.count > 1 ? `单张价格 × ${snapshot.count} 张` : "当前配置",
    });
  }

  function installBridge() {
    // The bundle exposes the same calculator used by the Generate button. The
    // presentation module reads the live model catalog, while this snapshot keeps
    // the currently selected canvas configuration visible when the table opens.
    if (window[BRIDGE_NAME]) return;
    window[BRIDGE_NAME] = {
      getRows: () => {
        const rows = buildPriceRows();
        return rows;
      },
      getSnapshot: () => {
        const getConfig = window.__vinsenCanvasConfigGetter;
        const calculate = window.__vinsenCanvasPriceCalculator;
        if (typeof getConfig !== "function" || typeof calculate !== "function") return {};
        let config;
        try { config = getConfig(); } catch (_) { return {}; }
        if (!config || typeof config !== "object") return {};
        const model = config.imageModel || config.model;
        if (!model) return {};
        let price;
        try { price = calculate({ ...config, model, count: 1 }); } catch (_) { return {}; }
        if (price == null) return {};
        const provider = String(config.provider || "").toLowerCase();
        const baseUrl = String(config.baseUrl || "").toLowerCase();
        const site = provider === "runninghub" || baseUrl.includes("runninghub.ai") ? "RH"
          : provider === "apimart" || baseUrl.includes("apimart.ai") ? "Mart"
          : provider === "soon" || baseUrl.includes("soonstudio.ai") ? "Soon"
          : provider === "tudou" || baseUrl.includes("ai-tudou.net") ? "Tudou"
          : provider === "grsai" || baseUrl.includes("grsai.com") ? "Grsai" : "当前站点";
        const currency = ["Soon", "Tudou", "Grsai"].includes(site) ? "CNY" : "USD";
        return {
          site,
          model: String(model).replace(/^.*::/, ""),
          quality: config.quality || config.gptImageQuality || "当前配置",
          price,
          currency,
          count: 1,
          note: "当前画布配置",
        };
      },
    };
  }

  function buildPriceRows() {
    const getConfig = window.__vinsenCanvasConfigGetter;
    const calculate = window.__vinsenCanvasPriceCalculator;
    if (typeof getConfig !== "function" || typeof calculate !== "function") return [];
    let config;
    try { config = getConfig(); } catch (_) { return []; }
    const channels = Array.isArray(config?.channels) ? config.channels : [];
    const rows = [];
    const names = { runninghub: "RH", apimart: "Mart", soon: "Soon", tudou: "Tudou", grsai: "Grsai" };
    const order = ["runninghub", "apimart", "tudou", "grsai", "soon"];
    const resolutions = ["1k", "2k", "4k"];
    channels.slice().sort((a, b) => order.indexOf(a.provider) - order.indexOf(b.provider)).forEach((channel) => {
      const provider = channel.provider;
      if (!names[provider]) return;
      const site = names[provider];
      const currency = ["runninghub", "apimart"].includes(provider) ? "USD" : "CNY";
      const models = Array.isArray(channel.models) ? channel.models : [];
      const add = (model, modelLabel, patch = {}, references = false, note = "") => {
        const priceByQuality = {};
        resolutions.forEach((quality) => {
          const requestConfig = { ...config, ...channel, ...patch, channels: [channel], model: `${channel.id}::${model}`, imageModel: `${channel.id}::${model}`, quality, count: 1, channelMode: "local" };
          try { priceByQuality[quality.toUpperCase()] = calculate(requestConfig, references); } catch (_) { priceByQuality[quality.toUpperCase()] = null; }
        });
        const values = Object.values(priceByQuality);
        const same = values.every((value) => value === values[0]);
        rows.push({ site, model: modelLabel, quality: same ? "1K / 2K / 4K" : "每张", currency,
          price: same ? values[0] : null, priceByQuality: same ? undefined : priceByQuality,
          note: values.every((value) => value == null) ? "按实际用量计费" : note,
          fullWidthNote: values.every((value) => value == null) });
      };
      const knownModels = [...new Set(models.map((model) => String(model).replace(/^.*::/, "")))];
      knownModels.forEach((model) => {
        if (["nano-banana-pro-2k", "nano-banana-pro-4k"].includes(model)) return;
        // Soon's 2.1 integration is intentionally deferred. Tudou and Grsai
        // already expose the model and must keep their live price rows.
        if (model === "nano-banana-2.1") {
          if (provider === "soon") return;
          return add(model, "Nano Banana 2.1");
        }
        if (model === "nano-banana-pro") return add(model, "Nano Banana Pro");
        if (model === "gpt-image-2.5" && provider === "runninghub") {
          add(model, "GPT Image 2.5 · 固定", { runningHubGpt25Mode: "fixed", gptImageQuality: "medium" });
          return add(model, "GPT Image 2.5 · 官方", { runningHubGpt25Mode: "official", gptImageQuality: "medium" });
        }
        if (["gpt-image-2", "gpt-image-2.5"].includes(model) && provider === "apimart") {
          const label = model === "gpt-image-2.5" ? "GPT Image 2.5" : "GPT Image 2";
          add(model, `${label} · 固定`, { gptImageQuality: "fixed" });
          return add(model, `${label} · 官方`, { gptImageQuality: "medium" });
        }
        if (["gpt-image-2", "gpt-image-2-all"].includes(model) && ["tudou", "runninghub"].includes(provider)) {
          ["low", "medium", "high"].forEach((quality) => add(model, `GPT Image 2 · ${quality}`, { gptImageQuality: quality }, false, provider === "runninghub" ? "无参考图" : ""));
          if (provider === "runninghub") add(model, "GPT Image 2 · low", { gptImageQuality: "low" }, true, "有参考图");
          return;
        }
        if (["gpt-image-2", "gpt-image-2-vip"].includes(model) && provider === "grsai") add(model, model === "gpt-image-2-vip" ? "GPT Image 2 VIP" : "GPT Image 2");
      });
    });
    return rows;
  }

  function rowsForDisplay() {
    // The live catalog is already generated from the same calculator used by
    // the canvas. Only add the one-off snapshot when the catalog is
    // unavailable; otherwise its raw model id (for example
    // `nano-banana-pro`) would duplicate the human-readable live row.
    const liveRows = bridgeRows();
    const rows = (liveRows || []).map(normalizeRow).filter(Boolean);
    const current = currentRow(bridgeSnapshot());
    if (!liveRows && current && !rows.some((row) => row.site === current.site && row.model === current.model && row.quality === current.quality)) rows.unshift(current);
    return rows;
  }

  function render(host) {
    const panel = host.querySelector(".canvas-price-table-panel");
    if (!panel) return;
    const rows = rowsForDisplay();
    const groups = new Map();
    rows.forEach((row) => {
      if (!groups.has(row.site)) groups.set(row.site, []);
      groups.get(row.site).push(row);
    });
    panel.replaceChildren();
    const heading = document.createElement("div");
    heading.className = "canvas-price-table-heading";
    const title = document.createElement("span");
    title.textContent = "模型价格（人民币）";
    heading.appendChild(title);
    const fx = document.createElement("label");
    fx.className = "canvas-price-table-fx";
    fx.append("美元汇率");
    const input = document.createElement("input");
    input.type = "number";
    input.min = "0.01";
    input.step = "0.01";
    input.inputMode = "decimal";
    input.value = String(getFxRate());
    input.setAttribute("aria-label", "美元兑人民币汇率");
    const apply = document.createElement("button");
    apply.type = "button";
    apply.textContent = "应用";
    apply.addEventListener("click", () => {
      if (setFxRate(input.value)) render(host);
      else input.value = String(getFxRate());
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") apply.click();
    });
    fx.append(input, apply);
    heading.appendChild(fx);
    panel.appendChild(heading);
    const rate = document.createElement("div");
    rate.className = "canvas-price-table-subtitle";
    rate.textContent = `按画布当前扣费信息计算；人民币 = 美元 × 汇率（当前 1 USD = ¥${getFxRate()}），表内只显示人民币。`;
    panel.appendChild(rate);
    if (!groups.size) {
      const empty = document.createElement("div");
      empty.className = "canvas-price-table-empty";
      empty.textContent = "暂无可读取的模型价格";
      panel.appendChild(empty);
      return;
    }
    groups.forEach((siteRows, site) => {
      const group = document.createElement("div");
      group.className = "canvas-price-table-group";
      group.classList.add(`provider-${site.toLowerCase()}`);
      const groupHead = document.createElement("div");
      groupHead.className = "canvas-price-table-group-head";
      const siteName = document.createElement("span");
      const advantages = { RH: "快速稳定", Mart: "需要魔法", Tudou: "经济实惠", Grsai: "备选一", Soon: "备选二" };
      siteName.textContent = advantages[site] ? `${site} · ${advantages[site]}` : site;
      const count = document.createElement("span");
      count.className = "canvas-price-table-count";
      count.textContent = `${siteRows.length} 个模型`;
      groupHead.append(siteName, count);
      group.appendChild(groupHead);
      const gridHead = document.createElement("div");
      gridHead.className = "canvas-price-table-grid canvas-price-table-grid-head";
      ["模型", "1K", "2K", "4K"].forEach((label) => {
        const cell = document.createElement("span");
        cell.textContent = label;
        gridHead.appendChild(cell);
      });
      group.appendChild(gridHead);
      siteRows.forEach((row) => {
        const item = document.createElement("div");
        item.className = "canvas-price-table-row canvas-price-table-grid";
        const name = document.createElement("div");
        name.className = "canvas-price-table-name";
        const model = document.createElement("span");
        model.className = "canvas-price-table-model";
        model.textContent = row.model;
            const quality = document.createElement("span");
            quality.className = "canvas-price-table-quality";
            // Resolution is already represented by the three price columns;
            // keep the model cell quiet instead of repeating it inline.
            quality.textContent = row.quality && !/^(1K \/ 2K \/ 4K|每张)$/i.test(row.quality) ? ` · ${row.quality}` : "";
        name.append(model, quality);
        if (row.note && !row.fullWidthNote) {
          const note = document.createElement("span");
          note.className = "canvas-price-table-note";
          note.textContent = row.note;
          name.appendChild(note);
        }
        item.appendChild(name);
        if (row.fullWidthNote && row.note) {
          const wideNote = document.createElement("div");
          wideNote.className = "canvas-price-table-wide-note";
          wideNote.textContent = row.note;
          item.appendChild(wideNote);
        } else {
          ["1K", "2K", "4K"].forEach((quality) => {
            const value = document.createElement("div");
            value.className = "canvas-price-table-value";
            value.textContent = formatPrice(row, quality);
            item.appendChild(value);
          });
        }
        group.appendChild(item);
      });
      panel.appendChild(group);
    });
  }

  function positionPanel(host) {
    const panel = host.querySelector(".canvas-price-table-panel");
    const toggle = host.querySelector(".canvas-price-table-toggle");
    if (!panel || !toggle || !host.classList.contains("is-open")) {
      if (panel) panel.style.left = "0px";
      return;
    }
    // Keep the wide panel inside the viewport on narrow screens while still
    // letting it align with the toolbar on desktop.
    panel.style.left = "0px";
    panel.style.right = "auto";
    requestAnimationFrame(() => {
      if (!host.classList.contains("is-open")) return;
      const toggleRect = toggle.getBoundingClientRect();
      const margin = 8;
      const maxLeft = Math.max(margin, window.innerWidth - panel.offsetWidth - margin);
      const viewportLeft = Math.min(Math.max(margin, toggleRect.left), maxLeft);
      panel.style.left = `${viewportLeft - toggleRect.left}px`;
    });
  }

  function attach() {
    const existing = document.querySelector(".canvas-price-table-host");
    const siteButton = document.querySelector(".canvas-site-switch-button");
    const shell = siteButton?.parentElement;
    if (!shell) return;
    shell.classList.add("canvas-price-table-shell");
    const host = existing || document.createElement("div");
    if (!existing) {
      host.className = "canvas-price-table-host";
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "canvas-price-table-toggle";
      toggle.setAttribute("aria-label", "打开模型价格表");
      toggle.title = "模型价格";
      toggle.innerHTML = `
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect x="3" y="5" width="18" height="14" rx="2"/>
          <circle cx="12" cy="12" r="3"/>
          <path d="M7 8h.01M17 16h.01"/>
        </svg>`;
      toggle.setAttribute("aria-expanded", "false");
      toggle.addEventListener("click", () => {
        host.classList.toggle("is-open");
        toggle.setAttribute("aria-expanded", host.classList.contains("is-open") ? "true" : "false");
        if (host.classList.contains("is-open")) {
          render(host);
          positionPanel(host);
        } else {
          positionPanel(host);
        }
      });
      const panel = document.createElement("div");
      panel.className = "canvas-price-table-panel";
      host.append(toggle, panel);
      ["pointerdown", "mousedown", "wheel"].forEach((event) => host.addEventListener(event, (e) => e.stopPropagation()));
    }
    // Keep the price icon in the toolbar's existing empty cell. The native
    // divider before the zoom value is the cell's left edge. This function is
    // called by a subtree MutationObserver, so the DOM operations must be
    // idempotent; removing and reinserting the divider on every callback would
    // create an endless observer loop and freeze project creation/import.
    const dividers = Array.from(shell.querySelectorAll(".canvas-price-table-divider"));
    const getDivider = (side) => {
      let divider = shell.querySelector(`.canvas-price-table-divider[data-price-table-divider="${side}"]`);
      if (!divider) {
        divider = document.createElement("span");
        divider.className = "canvas-price-table-divider";
        divider.dataset.priceTableDivider = side;
        divider.setAttribute("aria-hidden", "true");
      }
      return divider;
    };
    const dividerAfter = getDivider("after");
    dividers.filter((element) => element !== dividerAfter).forEach((element) => element.remove());
    const toolbarEnd = shell.lastElementChild;
    if (host.parentElement !== shell || host.nextElementSibling !== dividerAfter) shell.insertBefore(host, toolbarEnd);
    if (dividerAfter.parentElement !== shell || dividerAfter.previousElementSibling !== host) shell.insertBefore(dividerAfter, toolbarEnd);
    positionPanel(host);
    // Do not rebuild an open panel here: this function is called by the DOM
    // observer, and render itself changes the DOM.
  }

  function boot() {
    installStyles();
    installBridge();
    attach();
    const observer = new MutationObserver(() => attach());
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("resize", attach, { passive: true });
    window.addEventListener("vinsen-price-change", () => {
      const host = document.querySelector(".canvas-price-table-host");
      if (host?.classList.contains("is-open")) render(host);
    });
    // Close the panel when the user clicks elsewhere in the canvas. Events
    // inside the host are ignored so controls in the table remain usable.
    const closeOnOutsideClick = (event) => {
      const host = document.querySelector(".canvas-price-table-host");
      if (!host?.classList.contains("is-open") || host.contains(event.target)) return;
      host.classList.remove("is-open");
      const toggle = host.querySelector(".canvas-price-table-toggle");
      toggle?.setAttribute("aria-expanded", "false");
      positionPanel(host);
    };
    document.addEventListener("pointerdown", closeOnOutsideClick, true);
    document.addEventListener("click", closeOnOutsideClick, true);
    // Canvas state lives inside the bundle, so keep the open panel in sync even
    // when a config update does not emit a public event.
    let lastSnapshot = "";
    window.setInterval(() => {
      const host = document.querySelector(".canvas-price-table-host");
      if (!host?.classList.contains("is-open")) return;
      const snapshot = bridgeSnapshot();
      let key = "";
      try { key = JSON.stringify(snapshot); } catch (_) {}
      if (key && key !== lastSnapshot) {
        lastSnapshot = key;
        render(host);
      }
    }, 1200);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
})();
