// What a provider request is for: model, spec (resolution[/quality]) and image count.
// Shared by the server relay (to charge) and the browser (to show the same price).

const MAX_COUNT = 10;

// Grsai GPT image requests carry only a pixel size ("2048x1152"). In its size table
// every 1K size is under 2 MP and every 2K size under 5 MP.
function pixelResolution(size) {
    const m = /^(\d+)x(\d+)$/i.exec(String(size || "").trim());
    if (!m) return "";
    const pixels = Number(m[1]) * Number(m[2]);
    return pixels <= 2e6 ? "1k" : pixels <= 5e6 ? "2k" : "4k";
}

export function describeRequest(target, payload) {
    const p = payload && typeof payload === "object" ? payload : {};
    const path = target.pathname;
    const model = String(
        p.model
        || path.match(/\/models\/([^/:]+)/)?.[1]
        || path.match(/\/openapi\/v2\/([^/]+)/)?.[1]
        || "",
    ).split("::").at(-1).trim();
    const resolution = String(
        p.resolution
        ?? p.imageSize
        ?? p.image_size
        ?? p.generationConfig?.imageConfig?.imageSize
        // Grsai 2.6 with ratio "auto" sends no size at all: priced as 1K.
        ?? (p.aspectRatio === "auto" && /^gpt-image-2\.6-(flare|sunburst)$/.test(model) ? "1k" : pixelResolution(p.aspectRatio)),
    ).trim().toLowerCase();
    // GPT image quality (low/medium/high…) changes the upstream cost, so it is part of the spec.
    const quality = typeof p.quality === "string" ? p.quality.trim().toLowerCase() : "";
    const spec = [resolution, quality].filter(Boolean).join("/");
    const n = Math.trunc(Number(p.n ?? p.num_images ?? 1));
    const count = Number.isFinite(n) && n > 0 ? Math.min(n, MAX_COUNT) : 1;
    return { model, spec, count };
}
