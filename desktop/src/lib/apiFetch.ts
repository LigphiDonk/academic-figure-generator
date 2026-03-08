/**
 * CORS-safe fetch wrapper for Tauri desktop app.
 *
 * In Tauri mode, uses @tauri-apps/plugin-http's native fetch which bypasses
 * browser CORS restrictions. Falls back to browser's native fetch when running
 * outside Tauri (e.g. plain browser dev mode).
 */

type FetchFn = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

let _tauriFetch: FetchFn | null = null;
let _tauriFetchLoaded = false;

/** Detect whether we're running inside a Tauri v2 app. */
function isTauri(): boolean {
    return typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || typeof window.__TAURI__?.core?.invoke === 'function');
}

function formatFetchTarget(input: string | URL | Request): string {
    if (typeof input === 'string') return input;
    if (input instanceof URL) return input.toString();
    return input.url;
}

function formatFetchError(error: unknown): string {
    if (error instanceof Error && error.message.trim()) return error.message;
    return String(error);
}

async function loadTauriFetch(): Promise<FetchFn | null> {
    if (_tauriFetchLoaded) return _tauriFetch;
    _tauriFetchLoaded = true;

    if (!isTauri()) {
        _tauriFetch = null;
        return null;
    }

    try {
        const mod = await import('@tauri-apps/plugin-http');
        if (typeof mod.fetch === 'function') {
            _tauriFetch = mod.fetch as FetchFn;
        }
    } catch (error) {
        console.error('[apiFetch] Failed to load Tauri HTTP plugin:', error);
        _tauriFetch = null;
    }
    return _tauriFetch;
}

/**
 * Drop-in replacement for `fetch()` that works without CORS issues in Tauri.
 * Uses the native Tauri HTTP plugin in desktop runtime so API calls are not
 * affected by browser CORS, and uses the browser's built-in fetch elsewhere.
 */
export async function apiFetch(
    input: string | URL | Request,
    init?: RequestInit,
): Promise<Response> {
    if (isTauri()) {
        const tauriFetch = await loadTauriFetch();
        if (!tauriFetch) {
            throw new Error(
                'Tauri HTTP 插件不可用，无法在桌面版中发起跨域 API 请求。请检查插件是否已注册以及打包权限是否正确配置。',
            );
        }
        try {
            return await tauriFetch(input, init);
        } catch (tauriError) {
            const target = formatFetchTarget(input);
            const detail = formatFetchError(tauriError);
            console.error('[apiFetch] Tauri fetch failed:', { target, detail, tauriError });
            throw new Error(
                `Tauri 原生 HTTP 请求失败：${detail}（${target}）。这通常表示该 URL 未被 Tauri capability 放行，或代理/TLS 配置有问题。`,
            );
        }
    }

    return globalThis.fetch(input, init);
}
