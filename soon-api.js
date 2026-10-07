export const SOON_ORIGIN = "https://api.soonstudio.ai";
export const SOON_SITE_ID = "soon";
export const SOON_SITE_NAME = "Soon";
export const SOON_IMAGE_MODELS = ["nano-banana-pro"];
export const SOON_TEXT_MODELS = [];
export const SOON_SITE_MODELS = [...SOON_IMAGE_MODELS];
export const SOON_UPLOAD_URL = `${SOON_ORIGIN}/v1/files`;
export const SOON_UPLOAD_MAX_BYTES = 10 * 1024 * 1024;
export const SOON_MAX_REFERENCES = 14;

const SOON_UPLOAD_TARGET_BYTES = 9 * 1024 * 1024;
const RATIOS = new Set([
    "auto", "1:1", "2:3", "3:2", "3:4", "4:3",
    "4:5", "5:4", "9:16", "16:9", "21:9",
]);
const ORIGINS = new Set([
    SOON_ORIGIN, "https://api-hk.soonstudio.ai", "https://api-us.soonstudio.ai",
]);
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const TASK_TIMEOUT_MS = 10 * 60 * 1000;
const POLL_INTERVAL_MS = 2500;

export function isSoonSite(config) {
    if (config?.provider) return config.provider === SOON_SITE_ID;
    try { return ORIGINS.has(new URL(config?.baseUrl).origin); } catch { return false; }
}

function apiRoot(config) {
    const value = new URL(config?.baseUrl || SOON_ORIGIN);
    if (!ORIGINS.has(value.origin) || value.username || value.password
        || !["", "/", "/v1", "/v1/"].includes(value.pathname)) {
        throw new Error("Soon API 地址无效");
    }
    return `${value.origin}/v1`;
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
        "x-studio-channel-group": "default",
        "x-studio-request-model": "nano-banana-pro",
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

export function soonImageRequestSpec(config, prompt, imageUrls = []) {
    const model = String(config?.model || config?.imageModel || "nano-banana-pro").split("::").at(-1);
    if (!["nano-banana-pro", "nano-banana-pro-2k", "nano-banana-pro-4k"].includes(model)) {
        throw new Error("Soon 当前只接入 Nano Banana Pro");
    }
    if (!String(prompt || "").trim()) throw new Error("请输入提示词");
    const ratio = String(config?.size || "auto").trim().toLowerCase();
    if (!RATIOS.has(ratio)) throw new Error(`Soon 不支持比例 ${ratio}`);
    if (imageUrls.length > SOON_MAX_REFERENCES) throw new Error("Soon 最多支持 14 张参考图");
    for (const imageUrl of imageUrls) {
        let url;
        try { url = new URL(imageUrl); } catch {}
        if (url?.protocol !== "https:" || url.username || url.password) {
            throw new Error("Soon 参考图需要 HTTPS 地址");
        }
    }
    return {
        endpoint: "/images/generations?async=true",
        body: {
            model: "nano-banana-pro",
            prompt: String(prompt).trim(),
            n: 1,
            aspect_ratio: ratio,
            image_size: soonResolution(config),
            response_format: "url",
            ...(imageUrls.length ? { images: [...imageUrls] } : {}),
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
        for (const key of ["url", "image_url", "output", "images", "result", "data"]) {
            visit(value[key], depth + 1);
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

export async function runSoonImageGeneration(config, prompt, imageUrls = [], options = {}) {
    const root = apiRoot(config);
    const requestHeaders = headers(config);
    const spec = soonImageRequestSpec(config, prompt, imageUrls);
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
        const submitted = await fetchJson(`${root}${spec.endpoint}`, {
            method: "POST", headers: requestHeaders,
            body: JSON.stringify(spec.body), signal: timed.signal,
        }, fetchImpl);
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

export async function compressSoonReferenceBlob(original, targetBytes, options = {}) {
    checkAbort(options.signal);
    let image;
    let objectUrl;
    if (typeof createImageBitmap === "function") image = await createImageBitmap(original);
    else {
        objectUrl = URL.createObjectURL(original);
        image = new Image();
        image.src = objectUrl;
        try { await image.decode(); } catch (error) {
            URL.revokeObjectURL(objectUrl);
            throw error;
        }
    }
    try {
        const width = image.width || image.naturalWidth, height = image.height || image.naturalHeight;
        const canvas = document.createElement("canvas");
        try {
            for (const scale of [1, 0.8, 0.6, 0.4, 0.25]) {
                canvas.width = Math.max(1, Math.round(width * scale));
                canvas.height = Math.max(1, Math.round(height * scale));
                const context = canvas.getContext("2d");
                if (!context) throw new Error("Soon 无法创建上传副本");
                context.drawImage(image, 0, 0, canvas.width, canvas.height);
                for (const quality of [0.92, 0.8, 0.65, 0.45]) {
                    checkAbort(options.signal);
                    const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/webp", quality));
                    if (blob?.size && blob.size <= targetBytes) return blob;
                }
            }
        } finally { canvas.width = 0; canvas.height = 0; }
        throw new Error("Soon 上传副本压缩失败，本地原图未修改");
    } finally {
        image.close?.();
        if (objectUrl) URL.revokeObjectURL(objectUrl);
    }
}

export async function uploadSoonReferenceBlob(config, original, options = {}) {
    const requestHeaders = headers(config, false);
    if (!original?.size) throw new Error("Soon 参考图为空");
    if (!IMAGE_TYPES.has(String(original.type).toLowerCase())) throw new Error("Soon 参考图请使用 PNG、JPG、WebP 或 GIF");
    const timed = timedSignal(options.signal, options.timeoutMs ?? 180_000, "Soon 参考图上传超时，本地原图未修改");
    const fetchImpl = options.fetchImpl || fetch;
    let blob = original;
    const compressCopy = async targetBytes => {
        const compressed = await (options.compressImage || compressSoonReferenceBlob)(
            original, targetBytes, { signal: timed.signal },
        );
        if (!compressed?.size || compressed.size > targetBytes || !IMAGE_TYPES.has(compressed.type)) {
            throw new Error("Soon 上传副本压缩失败，本地原图未修改");
        }
        return compressed;
    };
    try {
        if (blob.size > SOON_UPLOAD_MAX_BYTES) {
            options.onProgress?.({ stage: "uploading", progress: 2 });
            blob = await compressCopy(SOON_UPLOAD_TARGET_BYTES);
        }
        for (let attempt = 0; attempt < 3; attempt += 1) {
            checkAbort(timed.signal);
            const form = new FormData();
            const extension = blob.type === "image/webp" ? "webp"
                : blob.type === "image/jpeg" ? "jpg" : blob.type === "image/gif" ? "gif" : "png";
            form.set("file", blob, `reference.${extension}`);
            options.onProgress?.({ stage: "uploading", progress: 2 });
            try {
                const payload = await fetchJson(SOON_UPLOAD_URL, {
                    method: "POST", headers: requestHeaders, body: form, signal: timed.signal,
                }, fetchImpl);
                const url = String(payload?.url || payload?.data?.url || "").trim();
                let valid = false;
                try {
                    const parsed = new URL(url);
                    valid = parsed.protocol === "https:" && !parsed.username && !parsed.password;
                } catch {}
                if (!valid) throw new Error("Soon 上传成功但没有返回有效 HTTPS 地址");
                options.onProgress?.({ stage: "uploading", progress: 10 });
                return url;
            } catch (error) {
                checkAbort(timed.signal);
                if (error.status === 401 || error.status === 403) {
                    throw new Error("Soon 原生上传未授权，请核对 API Key；平台可能需要开放此接口的 API Key 权限");
                }
                if (error.status !== 413 || attempt === 2) throw error;
                const target = Math.min(4 * 1024 * 1024, Math.floor(blob.size / 2));
                blob = await compressCopy(target);
            }
        }
    } catch (error) {
        if (timed.signal.aborted) throw timed.signal.reason || error;
        throw error;
    } finally { timed.dispose(); }
}
