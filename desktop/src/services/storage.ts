import type { AppSnapshot, ColorScheme, PublicSettings, SecureSettings } from '../types/models';
import { loadSecureSettingsFromRuntime, saveSecureSettingsToRuntime } from '../lib/runtime';

const SNAPSHOT_KEY = 'academic-figure-generator.desktop.snapshot.v2';
const LEGACY_SNAPSHOT_KEYS = ['academic-figure-generator.desktop.snapshot.v1'];
const SECURE_KEY = 'academic-figure-generator.desktop.secure.v1';
const CURRENT_SNAPSHOT_VERSION = 2;
const IMAGE_DB_NAME = 'academic-figure-generator.desktop.assets';
const IMAGE_STORE_NAME = 'imagePreviews';

const defaultSettings: PublicSettings = {
  defaultColorScheme: 'okabe-ito',
  defaultResolution: '2K',
  defaultAspectRatio: '4:3',
  setupCompleted: true,
  appVersion: '1.0.0',
  language: 'zh-CN',
  theme: 'system',
};

const emptySecureSettings: SecureSettings = {
  claudeApiKey: '',
  claudeBaseUrl: 'https://api.anthropic.com',
  claudeModel: 'claude-sonnet-4-20250514',
  nanobananaApiKey: '',
  nanobananaBaseUrl: 'https://api.keepgo.icu',
  ocrServerUrl: '',
  ocrToken: '',
};

function cloneSnapshot<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function emptySnapshot(): AppSnapshot {
  return {
    version: CURRENT_SNAPSHOT_VERSION,
    projects: [],
    documents: [],
    prompts: [],
    images: [],
    colorSchemes: [],
    usageLogs: [],
    settings: defaultSettings,
  };
}

function openImageDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(IMAGE_DB_NAME, 1);
    request.onerror = () => reject(request.error ?? new Error('无法打开图片资源库'));
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(IMAGE_STORE_NAME)) {
        db.createObjectStore(IMAGE_STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
  });
}

function withImageStore<T>(mode: IDBTransactionMode, handler: (store: IDBObjectStore, resolve: (value: T) => void, reject: (reason?: unknown) => void) => void): Promise<T> {
  return openImageDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(IMAGE_STORE_NAME, mode);
        const store = tx.objectStore(IMAGE_STORE_NAME);
        handler(store, resolve, reject);
        tx.oncomplete = () => db.close();
        tx.onerror = () => {
          db.close();
          reject(tx.error ?? new Error('图片资源库事务失败'));
        };
      }),
  );
}

export async function saveImagePreview(imageId: string, dataUrl: string): Promise<void> {
  await withImageStore<void>('readwrite', (store, resolve, reject) => {
    const request = store.put({ id: imageId, dataUrl, updatedAt: Date.now() });
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error('保存图片预览失败'));
  });
}

export async function loadImagePreview(imageId: string): Promise<string | undefined> {
  return withImageStore<string | undefined>('readonly', (store, resolve, reject) => {
    const request = store.get(imageId);
    request.onsuccess = () => resolve((request.result as { dataUrl?: string } | undefined)?.dataUrl);
    request.onerror = () => reject(request.error ?? new Error('读取图片预览失败'));
  });
}

export async function deleteImagePreview(imageId: string): Promise<void> {
  await withImageStore<void>('readwrite', (store, resolve, reject) => {
    const request = store.delete(imageId);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error('删除图片预览失败'));
  });
}

async function clearImagePreviews(): Promise<void> {
  await withImageStore<void>('readwrite', (store, resolve, reject) => {
    const request = store.clear();
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error('清空图片预览失败'));
  });
}

function normalizeSnapshot(parsed: Partial<AppSnapshot>): AppSnapshot {
  return {
    ...emptySnapshot(),
    ...parsed,
    version: CURRENT_SNAPSHOT_VERSION,
    images: Array.isArray(parsed.images)
      ? parsed.images.map((image) => ({
          ...image,
          previewDataUrl: undefined,
        }))
      : [],
    settings: {
      ...defaultSettings,
      ...(parsed.settings ?? {}),
    },
  };
}

async function migrateLegacyPreviews(parsed: Partial<AppSnapshot>): Promise<void> {
  const legacyImages = (parsed.images ?? []).filter((image) => typeof image.previewDataUrl === 'string' && image.previewDataUrl.length > 0);
  await Promise.all(legacyImages.map((image) => saveImagePreview(image.id, image.previewDataUrl!)));
}

export async function readSnapshot(): Promise<AppSnapshot> {
  const raw = localStorage.getItem(SNAPSHOT_KEY) ?? LEGACY_SNAPSHOT_KEYS.map((key) => localStorage.getItem(key)).find(Boolean) ?? null;
  if (!raw) {
    const snapshot = emptySnapshot();
    localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snapshot));
    return snapshot;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<AppSnapshot>;
    const requiresMigration = parsed.version !== CURRENT_SNAPSHOT_VERSION || (parsed.images ?? []).some((image) => Boolean(image.previewDataUrl));
    if (requiresMigration) {
      await migrateLegacyPreviews(parsed);
      const migrated = normalizeSnapshot(parsed);
      await writeSnapshot(migrated);
      return migrated;
    }
    return normalizeSnapshot(parsed);
  } catch {
    const snapshot = emptySnapshot();
    localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snapshot));
    return snapshot;
  }
}

export async function writeSnapshot(snapshot: AppSnapshot): Promise<void> {
  const persisted = normalizeSnapshot(snapshot);
  localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(persisted));
}

export async function mutateSnapshot<T>(mutator: (snapshot: AppSnapshot) => T | Promise<T>): Promise<T> {
  const snapshot = await readSnapshot();
  const next = cloneSnapshot(snapshot);
  const result = await mutator(next);
  await writeSnapshot(next);
  return result;
}

export async function readSecureSettings(): Promise<SecureSettings> {
  const runtimeValue = await loadSecureSettingsFromRuntime();
  if (runtimeValue) {
    return { ...emptySecureSettings, ...runtimeValue };
  }
  const raw = localStorage.getItem(SECURE_KEY);
  if (!raw) {
    return emptySecureSettings;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<SecureSettings>;
    return { ...emptySecureSettings, ...parsed };
  } catch {
    return emptySecureSettings;
  }
}

export async function writeSecureSettings(settings: SecureSettings): Promise<void> {
  const didPersistToRuntime = await saveSecureSettingsToRuntime(settings);
  if (!didPersistToRuntime) {
    localStorage.setItem(SECURE_KEY, JSON.stringify(settings));
  }
}

export async function resetAllData(preserveSecureSettings = true): Promise<void> {
  localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(emptySnapshot()));
  LEGACY_SNAPSHOT_KEYS.forEach((key) => localStorage.removeItem(key));
  await clearImagePreviews();
  if (!preserveSecureSettings) {
    localStorage.removeItem(SECURE_KEY);
  }
}

export function defaultPublicSettings(): PublicSettings {
  return defaultSettings;
}

export function defaultSecureSettings(): SecureSettings {
  return emptySecureSettings;
}

export function isCustomColorScheme(colorScheme: ColorScheme): boolean {
  return !colorScheme.isPreset;
}
