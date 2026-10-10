export const SOON_ORIGIN = "https://api.soonstudio.ai";
export const SOON_SITE_ID = "soon";
export const SOON_SITE_NAME = "Soon";
export const SOON_IMAGE_MODELS = ["nano-banana-pro"];
export const SOON_TEXT_MODELS = [];
export const SOON_SITE_MODELS = [...SOON_IMAGE_MODELS];
export const SOON_MAX_REFERENCES = 14;

const SOON_IMAGE_GROUP = "default";
const SOON_IMAGE_BACKEND_MODEL = "gemini-3-pro-image";
const RATIOS = new Set([
    "auto", "1:1", "2:3", "3:2", "3:4", "4:3",
    "4:5", "5:4", "9:16", "16:9", "21:9",
]);
const ORIGINS = new Set([
    SOON_ORIGIN, "https://api-hk.soonstudio.ai", "https://api-us.soonstudio.ai",
]);
const TASK_TIMEOUT_MS = 10 * 60 * 1000;
const POLL_INTERVAL_MS = 2500;

export function isSoonSite(config) {
    if (config?.provider) return config.provider === SOON_SITE_ID;
    try { return ORIGINS.has(new URL(config?.baseUrl).origin); } catch { return false; }
}

function apiOrigin(config) {
    const value = new URL(config?.baseUrl || SOON_ORIGIN);
    if (!ORIGINS.has(value.origin) || value.username || value.password
        || !["", "/", "/v1", "/v1/"].includes(value.pathname)) {
        throw new Error("Soon API 地址无效");
    }
    return value.origin;
}

function apiKey(config) {
    const key = String(config?.apiKey || "").trim();
    if (!key) throw new Error("请先在 Soon 设置中填写 API Key");
    return key;
}

function headers(config, json = true) {
    return {
        Accept: "application/json",
        Authorization: `Bearer ${apiKey(config)}`,
        "x-studio-channel-group": SOON_IMAGE_GROUP,
        "x-studio-request-model": SOON_IMAGE_BACKEND_MODEL,
        ...(json ? { "Content-Type": "application/json" } : {}),
    };
}

function checkAbort(signal) {
    if (signal?.aborted) throw signal.reason || new DOMException("Aborted", "AbortError");
}

function wait(ms, signal) {
    return new Promise((resolve, reject) => {
        checkAbort(signal);
        const cleanup = () => signal?.removeEventListener("abort", abort);
        const timer = setTimeout(() => { cleanup(); resolve(); }, ms);
        const abort = () => {
            clearTimeout(timer);
            cleanup();
            reject(signal.reason || new DOMException("Aborted", "AbortError"));
        };
        signal?.addEventListener("abort", abort, { once: true });
    });
}

function timedSignal(signal, timeoutMs, message) {
    checkAbort(signal);
    const controller = new AbortController();
    const abort = () => controller.abort(signal.reason);
    signal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(() => controller.abort(new Error(message)), timeoutMs);
    return {
        signal: controller.signal,
        dispose() {
            clearTimeout(timer);
            signal?.removeEventListener("abort", abort);
        },
    };
}

function message(payload, fallback) {
    return String(
        payload?.error?.message || (typeof payload?.error === "string" ? payload.error : "")
        || payload?.fail_reason || payload?.message || payload?.msg || fallback,
    ).trim();
}

async function fetchJson(url, init, fetchImpl) {
    const response = await fetchImpl(url, { credentials: "omit", ...init });
    const text = await response.text();
    let payload;
    try { payload = text ? JSON.parse(text) : {}; } catch {
        const error = new Error(`Soon 接口未返回 JSON（HTTP ${response.status}）`);
        error.status = response.status;
        throw error;
    }
    if (!response.ok || payload?.error || payload?.success === false
        || (typeof payload?.code === "number" && payload.code !== 0 && payload.code !== 200)) {
        const error = new Error(message(payload, `Soon 请求失败（HTTP ${response.status}）`));
        error.status = response.status;
        throw error;
    }
    return payload;
}

export function soonResolution(config) {
    const value = String(config?.quality || "auto").trim().toLowerCase();
    if (["4k", "high"].includes(value)) return "4K";
    if (["2k", "medium", "hd"].includes(value)) return "2K";
    return "1K";
}

export function soonImagePrice(config) {
    return soonResolution(config) === "4K" ? 0.33 : 0.24;
}

export function soonImageRequestSpec(config, prompt, imageParts = []) {
    const model = String(config?.model || config?.imageModel || "nano-banana-pro").split("::").at(-1);
    if (!["nano-banana-pro", "nano-banana-pro-2k", "nano-banana-pro-4k"].includes(model)) {
        throw new Error("Soon 当前只接入 Nano Banana Pro");
    }
    if (!String(prompt || "").trim()) throw new Error("请输入提示词");
    const ratio = String(config?.size || "auto").trim().toLowerCase();
    if (!RATIOS.has(ratio)) throw new Error(`Soon 不支持比例 ${ratio}`);
    if (imageParts.length > SOON_MAX_REFERENCES) throw new Error("Soon 最多支持 14 张参考图");
    return {
        endpoint: `/v1beta/models/${SOON_IMAGE_BACKEND_MODEL}:generateContent`,
        body: {
            contents: [{
                role: "user",
                parts: [{ text: String(prompt).trim() }, ...imageParts],
            }],
            generationConfig: {
                responseModalities: ["TEXT", "IMAGE"],
                imageConfig: { aspectRatio: ratio === "auto" ? "1:1" : ratio, imageSize: soonResolution(config) },
            },
        },
    };
}

function outputUrls(payload) {
    const urls = new Set();
    const visit = (value, depth = 0) => {
        if (depth > 5 || value == null) return;
        if (Array.isArray(value)) {
            value.forEach(item => visit(item, depth + 1));
            return;
        }
        if (typeof value === "string") {
            const url = value.trim();
            if (/^https:\/\//i.test(url) || /^data:image\//i.test(url)) urls.add(url);
            return;
        }
        if (typeof value !== "object") return;
        for (const key of ["url", "image_url", "output", "images", "result", "data", "candidates", "content", "parts"]) {
            visit(value[key], depth + 1);
        }
        const inline = value.inlineData || value.inline_data;
        if (inline && typeof inline.data === "string" && inline.data.trim()) {
            const mimeType = String(inline.mimeType || inline.mime_type || "image/png").trim() || "image/png";
            urls.add(`data:${mimeType};base64,${inline.data.trim()}`);
        }
        if (typeof value.b64_json === "string" && value.b64_json.trim()) {
            const base64 = value.b64_json.trim();
            urls.add(base64.startsWith("data:image/") ? base64 : `data:image/png;base64,${base64}`);
        }
    };
    visit(payload);
    return [...urls];
}

export function parseSoonTask(payload, submittedTaskId = "") {
    const record = payload?.data && !Array.isArray(payload.data) && typeof payload.data === "object"
        ? payload.data : payload;
    const taskId = String(payload?.task_id || record?.task_id
        || (typeof payload?.data === "string" && !/^https?:\/\//i.test(payload.data) ? payload.data : "")
        || submittedTaskId).trim();
    const status = String(record?.status || payload?.status || "").trim().toUpperCase();
    if (payload?.error || record?.error || ["FAILURE", "FAILED", "ERROR", "CANCELLED", "CANCELED"].includes(status)) {
        return { status: "failed", taskId, error: message(record, message(payload, "Soon 任务失败")) };
    }
    const urls = outputUrls(payload);
    if (["SUCCESS", "COMPLETED", "SUCCEEDED"].includes(status) || (!status && urls.length)) {
        return urls.length ? { status: "completed", taskId, urls }
            : { status: "failed", taskId, error: "Soon 任务完成但没有返回图片" };
    }
    if (urls.length || ["IN_PROGRESS", "PENDING", "QUEUED", "RUNNING", "PROCESSING", "SUBMITTED"].includes(status)
        || taskId) {
        const value = record?.progress;
        return {
            status: urls.length ? "completed" : "pending", taskId, ...(urls.length ? { urls } : {}),
            progress: value != null && Number.isFinite(Number(value))
                ? Math.max(0, Math.min(99, Number(value))) : undefined,
        };
    }
    return { status: "failed", taskId, error: message(record, "Soon 返回了未知任务状态") };
}

async function referenceToInlineData(reference, signal, fetchImpl = fetch) {
    checkAbort(signal);
    if (reference && typeof reference === "object" && reference.inlineData) return { inlineData: reference.inlineData };
    const source = typeof reference === "string" ? reference : reference?.dataUrl || reference?.url || "";
    if (!source) throw new Error("Soon 无法读取参考图");
    let mimeType = "image/png";
    let base64 = "";
    const dataMatch = String(source).match(/^data:([^;,]+);base64,(.+)$/s);
    if (dataMatch) {
        mimeType = dataMatch[1] || mimeType;
        base64 = dataMatch[2].replace(/\s+/g, "");
    } else {
        const response = await fetchImpl(source, { signal });
        if (!response.ok) throw new Error(`Soon 参考图读取失败（${response.status}）`);
        const blob = await response.blob();
        mimeType = blob.type || mimeType;
        const bytes = new Uint8Array(await blob.arrayBuffer());
        let binary = "";
        const chunkSize = 0x8000;
        for (let i = 0; i < bytes.length; i += chunkSize) {
            binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
        }
        base64 = btoa(binary);
    }
    if (!base64) throw new Error("Soon 参考图为空");
    return { inlineData: { mimeType, data: base64 } };
}

export async function runSoonImageGeneration(config, prompt, imageUrls = [], options = {}) {
    const origin = apiOrigin(config);
    const requestHeaders = headers(config);
    const imageParts = await Promise.all(imageUrls.map(reference => referenceToInlineData(reference, options.signal, options.fetchImpl || fetch)));
    const spec = soonImageRequestSpec(config, prompt, imageParts);
    const fetchImpl = options.fetchImpl || fetch;
    const sleep = options.sleep || wait;
    const now = options.now || Date.now;
    const timeoutMs = options.timeoutMs ?? TASK_TIMEOUT_MS;
    const startedAt = now();
    const timed = timedSignal(options.signal, timeoutMs, "Soon 生成超时，请到平台查看任务；没有重新提交生成");
    let taskId = "";
    try {
        // A billable submission is never retried automatically.
        options.onProgress?.({ stage: "generating", progress: 0 });
        const submitted = await fetchJson(`${origin}${spec.endpoint}`, {
            method: "POST", headers: requestHeaders,
            body: JSON.stringify(spec.body), signal: timed.signal,
        }, fetchImpl);
        const directUrls = outputUrls(submitted);
        if (directUrls.length) return directUrls;
        let result = parseSoonTask(submitted);
        taskId = result.taskId;
        if (result.status === "completed") return result.urls;
        if (result.status === "failed") throw new Error(result.error);
        if (!taskId) throw new Error("Soon 没有返回 task_id；请检查平台任务记录，不要立即重复提交");
        let errors = 0;
        options.onProgress?.({ stage: "generating", progress: result.progress ?? 0, taskId });
        while (now() - startedAt < timeoutMs) {
            await sleep(options.pollIntervalMs ?? POLL_INTERVAL_MS, timed.signal);
            checkAbort(timed.signal);
            try {
                const payload = await fetchJson(`${root}/images/tasks/${encodeURIComponent(taskId)}?language=zh`, {
                    method: "GET", headers: requestHeaders, signal: timed.signal, cache: "no-store",
                }, fetchImpl);
                errors = 0;
                result = parseSoonTask(payload, taskId);
                options.onProgress?.({ stage: "generating", progress: result.progress ?? 0, taskId });
                if (result.status === "completed") return result.urls;
                if (result.status === "failed") throw new Error(result.error);
            } catch (error) {
                checkAbort(timed.signal);
                const retryable = error instanceof TypeError || [408, 425, 429].includes(error.status)
                    || error.status >= 500;
                if (!retryable || ++errors > 3) throw error;
            }
        }
        throw new Error("Soon 生成超时，请到平台查看任务；没有重新提交生成");
    } catch (error) {
        if (timed.signal.aborted) error = timed.signal.reason || error;
        if (taskId && error instanceof Error && !timed.signal.aborted) {
            const failure = new Error(`${error.message}（任务 ID：${taskId}，请在 Soon 日志核对）`, { cause: error });
            failure.taskId = taskId;
            throw failure;
        }
        throw error;
    } finally {
        timed.dispose();
    }
}
