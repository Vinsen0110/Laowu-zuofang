// Keep the visible site selector aligned with the user's preferred workflow.
// Sites with their own reference upload first; Grsai (needs the user's Cloudinary) last.
export const SITE_DISPLAY_ORDER = ["tudou", "apimart", "runninghub", "grsai"];

// Users see numbered channels instead of provider names; admins see the real names.
export const SITE_CHANNEL_LABELS = { tudou: "渠道 1", apimart: "渠道 2", runninghub: "渠道 3", grsai: "渠道 4" };
export const SITE_CHANNEL_NOTES = { tudou: "推荐 · 性价比高", apimart: "便宜", grsai: "备用", runninghub: "最稳定 · 价格较高" };

// Sites only the admin sees (none for now).
export const ADMIN_ONLY_SITES = new Set();

export function siteVisible(siteId) {
    const id = String(siteId || "");
    // Switched off on the admin page: hidden for everyone, the admin too (account-ui.js loads the list).
    if (globalThis.__lwDisabledSites?.has(id)) return false;
    return globalThis.__lwIsAdmin === true || !ADMIN_ONLY_SITES.has(id);
}

export function siteDisplayName(channel) {
    if (globalThis.__lwIsAdmin === true) return channel?.name || "";
    return SITE_CHANNEL_LABELS[channel?.id] || channel?.name || "";
}

export function siteDisplayNote(channel) {
    return SITE_CHANNEL_NOTES[channel?.id] || "";
}

function stableOrder(values, rank) {
    return [...values]
        .map((value, index) => ({ value, index }))
        .sort((left, right) => rank(left.value) - rank(right.value) || left.index - right.index)
        .map(({ value }) => value);
}

function siteRank(siteId) {
    const index = SITE_DISPLAY_ORDER.indexOf(String(siteId || ""));
    return index < 0 ? SITE_DISPLAY_ORDER.length : index;
}

export function orderSiteChannels(channels = []) {
    return stableOrder(channels.filter((channel) => siteVisible(channel?.id)), (channel) => siteRank(channel?.id));
}

export function orderModelReferences(modelReferences = []) {
    const visible = modelReferences.filter((reference) => {
        const separator = String(reference || "").indexOf("::");
        return separator < 0 || siteVisible(String(reference).slice(0, separator));
    });
    return stableOrder(visible, (reference) => {
        const separator = String(reference || "").indexOf("::");
        const siteId = separator < 0 ? "" : String(reference).slice(0, separator);
        return siteRank(siteId);
    });
}

function ratioRank(preset) {
    const value = String(preset?.value || preset?.size || "").trim().toLowerCase();
    if (value === "auto") return -1;
    const match = value.match(/^(\d+)\s*:\s*(\d+)/);
    if (!match) return Number.MAX_SAFE_INTEGER;
    return Number(match[1]) * 10_000 + Number(match[2]);
}

export function orderRatioPresets(presets = []) {
    return stableOrder(presets, ratioRank);
}
