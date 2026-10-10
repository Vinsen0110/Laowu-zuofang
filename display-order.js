// Keep the visible site selector aligned with the user's preferred workflow.
export const SITE_DISPLAY_ORDER = ["runninghub", "apimart", "tudou", "grsai", "soon"];

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
    return stableOrder(channels, (channel) => siteRank(channel?.id));
}

export function orderModelReferences(modelReferences = []) {
    return stableOrder(modelReferences, (reference) => {
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
