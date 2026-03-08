import { generateClaudePrompts } from '../api/claudeClient';
import { FIGURE_TYPE_OPTIONS } from '../lib/catalog';
import { isoNow } from '../lib/utils';
import type { FigureType, PromptRecord } from '../types/models';
import { colorSchemeService } from './colorSchemeService';
import { documentService } from './documentService';
import { projectService } from './projectService';
import { settingsService } from './settingsService';
import { mutateSnapshot, readSnapshot } from './storage';
import { usageService } from './usageService';

function buildTemplatePrompt(input: {
  projectName: string;
  paperField?: string;
  figureType: FigureType;
  sectionTitles: string[];
  customRequest?: string;
}): string {
  const figureMeta = FIGURE_TYPE_OPTIONS.find((item) => item.id === input.figureType);
  const sectionLine = input.sectionTitles.length ? input.sectionTitles.join(', ') : 'selected paper context';
  return [
    `Create a publication-quality ${figureMeta?.name ?? input.figureType} for the project "${input.projectName}".`,
    `Target field: ${input.paperField ?? 'general academic research'}.`,
    `Use a white-dominant background with flat vector styling and a clear academic reading order.`,
    `Base the figure on these sections: ${sectionLine}.`,
    'Label every module, arrow, and key data transition explicitly.',
    input.customRequest ? `Extra instruction: ${input.customRequest}.` : undefined,
    `Use the ${figureMeta?.name ?? input.figureType} conventions: ${figureMeta?.description ?? 'professional academic figure layout'}.`,
  ].filter(Boolean).join(' ');
}

export class PromptService {
  async listPrompts(projectId: string): Promise<PromptRecord[]> {
    const snapshot = await readSnapshot();
    return snapshot.prompts.filter((item) => item.projectId === projectId).sort((a, b) => a.figureNumber - b.figureNumber);
  }

  async updatePrompt(id: string, editedPrompt: string): Promise<PromptRecord> {
    return mutateSnapshot((snapshot) => {
      const prompt = snapshot.prompts.find((item) => item.id === id);
      if (!prompt) throw new Error('提示词不存在');
      prompt.editedPrompt = editedPrompt;
      prompt.updatedAt = isoNow();
      return prompt;
    });
  }

  async deletePrompt(id: string): Promise<void> {
    const snapshot = await readSnapshot();
    const current = snapshot.prompts.find((item) => item.id === id);
    if (!current) return;
    await mutateSnapshot((next) => {
      next.prompts = next.prompts.filter((item) => item.id !== id);
      next.images = next.images.map((image) => (image.promptId === id ? { ...image, promptId: undefined } : image));
    });
    await projectService.touchProject(current.projectId);
  }

  async generatePrompts(input: {
    projectId: string;
    documentId?: string;
    selectedSectionTitles?: string[];
    pageRange?: [number, number];
    figureTypes: FigureType[];
    customRequest?: string;
    maxCount: number;
    templateMode: boolean;
  }): Promise<PromptRecord[]> {
    const project = await projectService.getProject(input.projectId);
    if (!project) throw new Error('项目不存在');

    const document = input.documentId ? await documentService.getDocument(input.documentId) : null;

    // Build scoped sections from page range or section titles
    let scopedSections: Array<{ title: string; content: string; level: number }> = [];

    if (input.pageRange && document) {
      const [startPage, endPage] = input.pageRange;
      const pageTexts = document.pageTexts ?? [];
      if (pageTexts.length > 0) {
        const selectedPages = pageTexts.slice(startPage, endPage + 1).filter(Boolean);
        const combinedText = selectedPages.join('\n\n');
        if (combinedText.trim()) {
          scopedSections = [{
            title: `第 ${startPage + 1} – ${endPage + 1} 页`,
            content: combinedText,
            level: 1,
          }];
        }
      } else if (document.parsedText && document.parsedText.trim()) {
        // Fallback: split parsedText roughly by page count
        const totalChars = document.parsedText.length;
        const totalPages = document.pageCount ?? 1;
        const charsPerPage = Math.ceil(totalChars / totalPages);
        const start = startPage * charsPerPage;
        const end = Math.min((endPage + 1) * charsPerPage, totalChars);
        const sliced = document.parsedText.slice(start, end);
        if (sliced.trim()) {
          scopedSections = [{
            title: `第 ${startPage + 1} – ${endPage + 1} 页`,
            content: sliced,
            level: 1,
          }];
        }
      }

      // Fallback: if page range extraction produced nothing, use all sections
      if (scopedSections.length === 0 && document.sections.length > 0) {
        scopedSections = document.sections;
      }
    } else if (document) {
      // No page range: use section-based fallback
      scopedSections = (document.sections ?? []).filter(
        (section) => !input.selectedSectionTitles?.length || input.selectedSectionTitles.includes(section.title),
      );
      // If no sections matched, use all sections
      if (scopedSections.length === 0 && document.sections.length > 0) {
        scopedSections = document.sections;
      }
    }

    if (!input.templateMode && scopedSections.length === 0) {
      throw new Error('文档内容为空，无法生成提示词。请确保文档已成功解析，或使用模板模式。');
    }

    const timestamp = isoNow();
    const figureTypes: FigureType[] = input.figureTypes.length ? input.figureTypes : ['overall_framework'];
    const colors = (await colorSchemeService.getColorScheme(project.colorScheme))?.colors;
    if (!colors) throw new Error('当前项目的配色方案不存在');

    let prompts: PromptRecord[];
    let claudeUsage: { inputTokens: number; outputTokens: number; model: string; durationMs: number } | undefined;

    if (input.templateMode) {
      prompts = figureTypes.slice(0, input.maxCount).map((figureType, index) => {
        const meta = FIGURE_TYPE_OPTIONS.find((item) => item.id === figureType);
        return {
          id: crypto.randomUUID(),
          projectId: project.id,
          documentId: document?.id,
          figureNumber: index + 1,
          title: `${meta?.name ?? '学术配图'}草案 ${index + 1}`,
          originalPrompt: buildTemplatePrompt({
            projectName: project.name,
            paperField: project.paperField,
            figureType,
            sectionTitles: scopedSections.map((section) => section.title),
            customRequest: input.customRequest,
          }),
          suggestedFigureType: figureType,
          suggestedAspectRatio: meta?.defaultAspectRatio,
          sourceSections: {
            titles: scopedSections.map((section) => section.title),
            rationale: 'Generated from template mode.',
          },
          generationStatus: 'completed',
          createdAt: timestamp,
          updatedAt: timestamp,
        };
      });
    } else {
      const secureSettings = await settingsService.getSecureSettings();
      if (!secureSettings.claudeApiKey.trim()) throw new Error('Claude API Key 未配置');
      const response = await generateClaudePrompts({
        secureSettings,
        sections: scopedSections,
        colorScheme: colors,
        paperField: project.paperField,
        requestedFigureTypes: figureTypes,
        maxCount: input.maxCount,
        customRequest: input.customRequest,
        templateMode: false,
      });
      claudeUsage = {
        inputTokens: response.inputTokens,
        outputTokens: response.outputTokens,
        model: response.model,
        durationMs: response.durationMs,
      };
      prompts = response.figures.map((figure) => ({
        id: crypto.randomUUID(),
        projectId: project.id,
        documentId: document?.id,
        figureNumber: figure.figure_number,
        title: figure.title,
        originalPrompt: figure.prompt,
        suggestedFigureType: figure.suggested_figure_type,
        suggestedAspectRatio: figure.suggested_aspect_ratio as PromptRecord['suggestedAspectRatio'],
        sourceSections: {
          titles: figure.source_section_titles,
          rationale: figure.rationale,
        },
        claudeModel: response.model,
        generationStatus: 'completed',
        createdAt: timestamp,
        updatedAt: timestamp,
      }));
    }

    await mutateSnapshot((snapshot) => {
      snapshot.prompts.push(...prompts);
    });
    await projectService.touchProject(project.id);

    if (claudeUsage) {
      const secureSettings = await settingsService.getSecureSettings();
      await usageService.recordUsage({
        projectId: project.id,
        apiName: 'claude',
        apiEndpoint: `${secureSettings.claudeBaseUrl}/v1/messages`,
        inputTokens: claudeUsage.inputTokens,
        outputTokens: claudeUsage.outputTokens,
        claudeModel: claudeUsage.model,
        requestDurationMs: claudeUsage.durationMs,
        isSuccess: true,
      });
    }

    return prompts;
  }
}

export const promptService = new PromptService();
