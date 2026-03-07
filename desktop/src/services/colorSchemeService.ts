import { PRESET_COLOR_SCHEMES } from '../lib/catalog';
import { isoNow } from '../lib/utils';
import type { ColorScheme, ColorValues } from '../types/models';
import { mutateSnapshot, readSnapshot } from './storage';

export class ColorSchemeService {
  async listColorSchemes(): Promise<ColorScheme[]> {
    const snapshot = await readSnapshot();
    return [...PRESET_COLOR_SCHEMES, ...snapshot.colorSchemes].sort((a, b) => {
      if (a.isPreset !== b.isPreset) return a.isPreset ? -1 : 1;
      return a.name.localeCompare(b.name, 'zh-CN');
    });
  }

  async getColorScheme(id: string): Promise<ColorScheme | null> {
    const all = await this.listColorSchemes();
    return all.find((item) => item.id === id) ?? null;
  }

  async createColorScheme(input: { name: string; description: string; colors: ColorValues }): Promise<ColorScheme> {
    return mutateSnapshot((snapshot) => {
      const timestamp = isoNow();
      const colorScheme: ColorScheme = {
        id: crypto.randomUUID(),
        name: input.name,
        description: input.description,
        colors: input.colors,
        isDefault: false,
        isPreset: false,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      snapshot.colorSchemes.push(colorScheme);
      return colorScheme;
    });
  }

  async updateColorScheme(id: string, input: { name: string; description: string; colors: ColorValues }): Promise<ColorScheme> {
    return mutateSnapshot((snapshot) => {
      const target = snapshot.colorSchemes.find((item) => item.id === id);
      if (!target) throw new Error('找不到要更新的配色方案');
      target.name = input.name;
      target.description = input.description;
      target.colors = input.colors;
      target.updatedAt = isoNow();
      return target;
    });
  }

  async deleteColorScheme(id: string): Promise<void> {
    await mutateSnapshot((snapshot) => {
      snapshot.colorSchemes = snapshot.colorSchemes.filter((item) => item.id !== id);
      snapshot.projects = snapshot.projects.map((project) =>
        project.colorScheme === id ? { ...project, colorScheme: 'okabe-ito', updatedAt: isoNow() } : project,
      );
    });
  }
}

export const colorSchemeService = new ColorSchemeService();
