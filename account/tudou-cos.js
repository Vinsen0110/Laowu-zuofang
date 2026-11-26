// 土豆 results delivered from Tencent Cloud COS (Guangzhou) instead of this Hong Kong server.
//
// 土豆 answers Nano Banana with the whole picture as base64 inside the reply. Mainland users
// download that from Hong Kong at a few dozen KB/s at busy hours (2026-11-25: a 2K picture
// made in 33 s took another 88 s to arrive). The server reaches COS quickly, so it puts the
// picture there untouched (same bytes, no re-encoding) and the reply carries the COS link,
// which the canvas already reads (fileData.fileUri).

import { cosReady, dropUnusedSignatures, moveInlineImagesToCos, parseGeminiAnswer } from "./cos.js";

// The COS settings to deliver with, or null when the admin chose "直连平台" or COS is not set up.
export function deliveryCos(cos) {
    return cosReady(cos) && cos.delivery !== "direct" ? cos : null;
}

function sseData(value) {
    return `data: ${JSON.stringify(value)}\n\n`;
}

// raw: 土豆's whole reply (JSON or SSE text). Returns the SSE text to send to the browser.
// Falls back to the reply as it came whenever COS is off or anything goes wrong.
export async function tudouGeminiAnswer(raw, cos, { signal, fetchImpl, onError = () => {} } = {}) {
    const payload = cos ? parseGeminiAnswer(raw) : null;
    if (payload) {
        try {
            if (await moveInlineImagesToCos(cos, payload, { signal, fetchImpl }) > 0) {
                dropUnusedSignatures(payload);
                return sseData(payload);
            }
        } catch (error) {
            if (signal?.aborted) throw error;
            onError(error);
        }
    }
    if (String(raw).trimStart().startsWith("data:")) return String(raw);
    try {
        return sseData(JSON.parse(raw));
    } catch {
        return sseData({ error: { message: raw || "Tudou returned an empty response" } });
    }
}
