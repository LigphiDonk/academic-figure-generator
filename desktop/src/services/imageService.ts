import { generateNanoImage } from '../api/nanobananaClient';
import { isoNow } from '../lib/utils';
import type { AspectRatio, ColorValues, ImageRecord, Resolution } from '../types/models';
import { colorSchemeService } from './colorSchemeService';
import { projectService } from './projectService';
import { promptService } from './promptService';
import { settingsService } from './settingsService';
import { deleteImagePreview, loadImagePreview, mutateSnapshot, readSnapshot, saveImagePreview } from './storage';
import { usageService } from './usageService';

export type ImageGenerationPhase = 'preparing' | 'requesting' | 'streaming' | 'retrying' | 'decoding' | 'saving' | 'completed';

export interface ImageGenerationProgress {
  phase: ImageGenerationPhase;
  message: string;
  previewDataUrl?: string;
}

function getPromptText(prompt: { originalPrompt?: string; editedPrompt?: string }): string {
  return prompt.editedPrompt?.trim() || prompt.originalPrompt?.trim() || '';
}

export class ImageService {
  async listImages(projectId?: string): Promise<ImageRecord[]> {
    const snapshot = await readSnapshot();
    const filtered = snapshot.images
      .filter((item) => (projectId ? item.projectId === projectId : !item.projectId))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return Promise.all(
      filtered.map(async (item) => ({
        ...item,
        previewDataUrl: await loadImagePreview(item.id),
      })),
    );
  }

  async deleteImage(id: string): Promise<void> {
    await deleteImagePreview(id);
    await mutateSnapshot((snapshot) => {
      snapshot.images = snapshot.images.filter((item) => item.id !== id);
    });
  }

  async generateImage(input: {
    projectId?: string;
    promptId?: string;
    promptText: string;
    resolution: Resolution;
    aspectRatio: AspectRatio;
    colorSchemeId?: string;
    referenceImage?: File;
    editInstruction?: string;
  }, options?: {
    onProgress?: (progress: ImageGenerationProgress) => void;
  }): Promise<ImageRecord> {
    const emitProgress = (progress: ImageGenerationProgress) => {
      options?.onProgress?.(progress);
    };

    emitProgress({
      phase: 'preparing',
      message: '正在准备图片生成参数...',
    });

    const secureSettings = await settingsService.getSecureSettings();
    if (!secureSettings.nanobananaApiKey.trim()) throw new Error('NanoBanana API Key 未配置');
    const colors = input.colorSchemeId ? (await colorSchemeService.getColorScheme(input.colorSchemeId))?.colors : undefined;
    const imageId = crypto.randomUUID();
    const response = await generateNanoImage({
      secureSettings,
      prompt: input.promptText,
      resolution: input.resolution,
      aspectRatio: input.aspectRatio,
      colorScheme: describeColorScheme(input.colorSchemeId, colors),
      referenceImage: input.referenceImage,
      editInstruction: input.editInstruction,
    }, {
      onProgress: (progress) => {
        emitProgress(progress);
      },
    });

    emitProgress({
      phase: 'saving',
      message: '正在保存图片到本地历史...',
      previewDataUrl: response.previewDataUrl,
    });

    await saveImagePreview(imageId, response.previewDataUrl);

    const timestamp = isoNow();
    const image: ImageRecord = {
      id: imageId,
      projectId: input.projectId,
      promptId: input.promptId,
      resolution: input.resolution,
      aspectRatio: input.aspectRatio,
      colorScheme: input.colorSchemeId,
      customColors: colors,
      referenceImagePath: input.referenceImage?.name,
      editInstruction: input.editInstruction,
      filePath: input.projectId ? `images/${input.projectId}` : 'images/direct',
      fileSizeBytes: response.fileSizeBytes,
      widthPx: response.width,
      heightPx: response.height,
      finalPromptSent: response.finalPromptSent,
      generationStatus: 'completed',
      generationDurationMs: response.durationMs,
      retryCount: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    await mutateSnapshot((snapshot) => {
      snapshot.images.push(image);
    });
    if (input.projectId) await projectService.touchProject(input.projectId);
    await usageService.recordUsage({
      projectId: input.projectId,
      apiName: 'nanobanana',
      apiEndpoint: response.endpoint,
      resolution: input.resolution,
      aspectRatio: input.aspectRatio,
      requestDurationMs: response.durationMs,
      isSuccess: true,
    });

    emitProgress({
      phase: 'completed',
      message: '图片已生成并写入本地历史',
      previewDataUrl: response.previewDataUrl,
    });

    return { ...image, previewDataUrl: response.previewDataUrl };
  }

  async generateFromPrompt(input: {
    projectId: string;
    promptId: string;
    resolution: Resolution;
    aspectRatio: AspectRatio;
    colorSchemeId: string;
    referenceImage?: File;
    editInstruction?: string;
  }, options?: {
    onProgress?: (progress: ImageGenerationProgress) => void;
  }): Promise<ImageRecord> {
    const prompts = await promptService.listPrompts(input.projectId);
    const prompt = prompts.find((item) => item.id === input.promptId);
    if (!prompt) throw new Error('提示词不存在');
    return this.generateImage({
      projectId: input.projectId,
      promptId: input.promptId,
      promptText: getPromptText(prompt),
      resolution: input.resolution,
      aspectRatio: input.aspectRatio,
      colorSchemeId: input.colorSchemeId,
      referenceImage: input.referenceImage,
      editInstruction: input.editInstruction,
    }, options);
  }
}

function describeColorScheme(colorSchemeId?: string, colors?: ColorValues): string {
  if (colors) {
    return [
      colorSchemeId ?? 'custom',
      `primary=${colors.primary}`,
      `secondary=${colors.secondary}`,
      `tertiary=${colors.tertiary}`,
      `text=${colors.text}`,
      `fill=${colors.fill}`,
      `section_bg=${colors.sectionBg}`,
      `border=${colors.border}`,
      `arrow=${colors.arrow}`,
    ].join(', ');
  }
  return colorSchemeId ?? 'default academic palette';
}

export const imageService = new ImageService();
