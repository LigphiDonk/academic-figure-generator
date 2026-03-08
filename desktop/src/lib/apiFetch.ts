/**
 * CORS-safe fetch wrapper for Tauri desktop app.
 *
 * In Tauri mode, uses @tauri-apps/plugin-http's native fetch which bypasses
 * browser CORS restrictions. Falls back to browser's native fetch when running
 * outside Tauri (e.g. plain browser dev mode).
 */

let _tauriFetch: typeof globalThis.fetch | null = null;
let _tauriFetchLoaded = false;

async function loadTauriFetch(): Promise<typeof globalThis.fetch | null> {
    if (_tauriFetchLoaded) return _tauriFetch;
    _tauriFetchLoaded = true;
    try {
        // Dynamic import so it doesn't break in non-Tauri environments
        const mod = await import('@tauri-apps/plugin-http');
        _tauriFetch = mod.fetch as typeof globalThis.fetch;
    } catch {
        _tauriFetch = null;
    }
    return _tauriFetch;
}

/**
 * Drop-in replacement for `fetch()` that works without CORS issues in Tauri.
 * Uses the native Tauri HTTP plugin when available, otherwise falls back to
 * the browser's built-in fetch.
 */
export async function apiFetch(
    input: string | URL | Request,
    init?: RequestInit,
): Promise<Response> {
    const tauriFetch = await loadTauriFetch();
    if (tauriFetch) {
        return tauriFetch(input, init);
    }
    return globalThis.fetch(input, init);
}
