import type { AppPaths, PublicSettings, SecureSettings } from '../types/models';
import { getRuntimePaths } from '../lib/runtime';
import { defaultPublicSettings, defaultSecureSettings, mutateSnapshot, readSecureSettings, readSnapshot, writeSecureSettings } from './storage';

export class SettingsService {
  async getPublicSettings(): Promise<PublicSettings> {
    const snapshot = await readSnapshot();
    return snapshot.settings;
  }

  async getSecureSettings(): Promise<SecureSettings> {
    return readSecureSettings();
  }

  async getAppPaths(): Promise<AppPaths> {
    return getRuntimePaths();
  }

  async savePublicSettings(input: Partial<PublicSettings>): Promise<PublicSettings> {
    return mutateSnapshot((snapshot) => {
      snapshot.settings = { ...snapshot.settings, ...input };
      return snapshot.settings;
    });
  }

  async saveSecureSettings(input: Partial<SecureSettings>): Promise<SecureSettings> {
    const current = await readSecureSettings();
    const next = { ...current, ...input };
    await writeSecureSettings(next);
    return next;
  }

  async completeSetup(input: { secureSettings: SecureSettings; publicSettings?: Partial<PublicSettings> }) {
    await writeSecureSettings(input.secureSettings);
    const publicSettings = await this.savePublicSettings({ ...input.publicSettings, setupCompleted: true });
    return { publicSettings, secureSettings: input.secureSettings };
  }

  async resetAllUserData() {
    const publicSettings = await this.savePublicSettings(defaultPublicSettings());
    const secureSettings = defaultSecureSettings();
    await writeSecureSettings(secureSettings);
    return { publicSettings, secureSettings };
  }
}

export const settingsService = new SettingsService();
