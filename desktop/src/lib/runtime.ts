import type { AppPaths, SecureSettings } from '../types/models';

type TauriCore = {
  invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>;
};

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
