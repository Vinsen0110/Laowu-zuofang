// What a provider request is for: model, spec (resolution[/quality]) and image count.
// Shared by the server relay (to charge) and the browser (to show the same price).

const MAX_COUNT = 10;

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
        ?? "",
    ).trim().toLowerCase();
    // GPT image quality (low/medium/high…) changes the upstream cost, so it is part of the spec.
    const quality = typeof p.quality === "string" ? p.quality.trim().toLowerCase() : "";
    const spec = [resolution, quality].filter(Boolean).join("/");
    const n = Math.trunc(Number(p.n ?? p.num_images ?? 1));
    const count = Number.isFinite(n) && n > 0 ? Math.min(n, MAX_COUNT) : 1;
    return { model, spec, count };
}
