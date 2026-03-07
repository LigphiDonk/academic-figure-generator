import { create } from 'zustand';
import type { AppPaths, PublicSettings, SecureSettings } from '../types/models';
import { settingsService } from '../services/settingsService';

interface SettingsState {
  isLoaded: boolean;
  publicSettings: PublicSettings | null;
  secureSettings: SecureSettings | null;
  appPaths: AppPaths | null;
  load: () => Promise<void>;
  refresh: () => Promise<void>;
  saveSetup: (input: { publicSettings?: Partial<PublicSettings>; secureSettings: SecureSettings }) => Promise<void>;
  savePublicSettings: (input: Partial<PublicSettings>) => Promise<void>;
  saveSecureSettings: (input: Partial<SecureSettings>) => Promise<void>;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  isLoaded: false,
  publicSettings: null,
  secureSettings: null,
  appPaths: null,
  load: async () => {
    const [publicSettings, secureSettings, appPaths] = await Promise.all([
      settingsService.getPublicSettings(),
      settingsService.getSecureSettings(),
      settingsService.getAppPaths(),
    ]);
    set({ isLoaded: true, publicSettings, secureSettings, appPaths });
  },
  refresh: async () => {
    const [publicSettings, secureSettings, appPaths] = await Promise.all([
      settingsService.getPublicSettings(),
      settingsService.getSecureSettings(),
      settingsService.getAppPaths(),
    ]);
    set({ isLoaded: true, publicSettings, secureSettings, appPaths });
  },
  saveSetup: async (input) => {
    const result = await settingsService.completeSetup(input);
    const appPaths = await settingsService.getAppPaths();
    set({ isLoaded: true, publicSettings: result.publicSettings, secureSettings: result.secureSettings, appPaths });
  },
  savePublicSettings: async (input) => {
    const publicSettings = await settingsService.savePublicSettings(input);
    set((state) => ({ ...state, publicSettings }));
  },
  saveSecureSettings: async (input) => {
    const secureSettings = await settingsService.saveSecureSettings(input);
    set((state) => ({ ...state, secureSettings }));
  },
}));
