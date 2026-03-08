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
    return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
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
    } catch {
        _tauriFetch = null;
    }
    return _tauriFetch;
}

/**
 * Drop-in replacement for `fetch()` that works without CORS issues in Tauri.
 * Uses the native Tauri HTTP plugin when available, otherwise falls back to
 * the browser's built-in fetch.
 *
 * If the Tauri fetch throws (e.g. plugin not loaded), it will fall back to
 * the browser fetch automatically.
 */
export async function apiFetch(
    input: string | URL | Request,
    init?: RequestInit,
): Promise<Response> {
    const tauriFetch = await loadTauriFetch();

    if (tauriFetch) {
        try {
            return await tauriFetch(input, init);
        } catch (tauriError) {
            // If Tauri fetch fails (e.g. plugin not available at runtime),
            // log and fall back to native fetch
            console.warn('[apiFetch] Tauri fetch failed, falling back to native fetch:', tauriError);
        }
    }

    // Fallback: native browser fetch
    return globalThis.fetch(input, init);
}
