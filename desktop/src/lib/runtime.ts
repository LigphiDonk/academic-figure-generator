import type { AppPaths, SecureSettings } from '../types/models';

const REPO_URL = 'https://github.com/LigphiDonk/academic-figure-generator';

type TauriCore = {
  invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>;
};

interface SavedFileResult {
  path: string;
}

declare global {
  interface Window {
    __TAURI__?: {
      core?: TauriCore;
    };
  }
}

const browserPaths: AppPaths = {
  mode: 'browser',
  appDataDir: 'Browser LocalStorage Preview',
  documentsDir: 'Browser LocalStorage Preview / documents',
  imagesDir: 'Browser LocalStorage Preview / images',
};

export function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && typeof window.__TAURI__?.core?.invoke === 'function';
}

export async function invokeCommand<T>(command: string, args?: Record<string, unknown>): Promise<T | undefined> {
  if (!isTauriRuntime()) {
    return undefined;
  }
  return window.__TAURI__!.core!.invoke<T>(command, args);
}

export async function loadSecureSettingsFromRuntime(): Promise<SecureSettings | undefined> {
  return invokeCommand<SecureSettings>('load_secure_settings');
}

export async function saveSecureSettingsToRuntime(settings: SecureSettings): Promise<boolean> {
  const result = await invokeCommand<boolean>('save_secure_settings', { settings });
  return result ?? false;
}

export async function getRuntimePaths(): Promise<AppPaths> {
  const result = await invokeCommand<AppPaths>('get_app_paths');
  return result ?? browserPaths;
}

export async function openRepositoryUrl(): Promise<void> {
  if (isTauriRuntime()) {
    await invokeCommand<boolean>('open_repository_url');
    return;
  }

  window.open(REPO_URL, '_blank', 'noopener,noreferrer');
}

export async function saveImageToDownloads(fileName: string, dataUrl: string): Promise<string | undefined> {
  if (isTauriRuntime()) {
    const result = await invokeCommand<SavedFileResult>('save_image_to_downloads', { fileName, dataUrl });
    return result?.path;
  }

  const link = document.createElement('a');
  link.href = dataUrl;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  return undefined;
}
