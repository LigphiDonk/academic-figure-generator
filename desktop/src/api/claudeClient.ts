import { FIGURE_TYPES } from '../core/prompts/figureTypes';
import { ACADEMIC_FIGURE_SYSTEM_PROMPT, TEMPLATE_FIGURE_SYSTEM_PROMPT } from '../core/prompts/systemPrompt';
import { apiFetch } from '../lib/apiFetch';
import type { ColorValues, FigureType, SecureSettings } from '../types/models';

export interface ClaudeFigureDraft {
  figure_number: number;
  title: string;
  suggested_figure_type: FigureType;
  suggested_aspect_ratio: string;
  prompt: string;
  source_section_titles: string[];
  rationale: string;
}

export interface ClaudeResponse {
  figures: ClaudeFigureDraft[];
  inputTokens: number;
  outputTokens: number;
  model: string;
  durationMs: number;
}

interface ClaudeRequest {
  secureSettings: SecureSettings;
  sections: Array<{ title: string; content: string; level: number }>;
  colorScheme: ColorValues;
  paperField?: string;
  requestedFigureTypes: FigureType[];
  maxCount: number;
  customRequest?: string;
  templateMode?: boolean;
}

function serializeColorScheme(colorScheme: ColorValues): string {
  return JSON.stringify(
    {
      primary: colorScheme.primary,
      secondary: colorScheme.secondary,
      tertiary: colorScheme.tertiary,
      text: colorScheme.text,
      fill: colorScheme.fill,
      section_bg: colorScheme.sectionBg,
      border: colorScheme.border,
      arrow: colorScheme.arrow,
    },
    null,
    2,
  );
}

function buildUserPrompt(request: ClaudeRequest): string {
  let typeHint = '';
  if (request.requestedFigureTypes.length > 0) {
    const typeDescriptions = request.requestedFigureTypes
      .filter((figureType) => figureType in FIGURE_TYPES)
      .map((figureType) => `- ${figureType}: ${FIGURE_TYPES[figureType].description}`);
    if (typeDescriptions.length > 0) {
      typeHint = `\n\nPreferred figure types for this paper:\n${typeDescriptions.join('\n')}`;
    }
  }

  const sectionText = request.sections
    .map((section, index) => `## Section ${index + 1}: ${section.title || 'Untitled'}\n${section.content}`)
    .join('\n\n');

  let requestBlock = '';
  const userRequest = [request.paperField ? `Academic field: ${request.paperField}` : '', request.customRequest?.trim() ?? '']
    .filter(Boolean)
    .join('\n');
  if (userRequest) {
    requestBlock = `\n\nUser requested figures (highest priority):\n${userRequest}\n`;
  }

  const countHint = request.maxCount > 0 ? `Generate at most ${request.maxCount} figure prompt(s). ` : '';

  return (
    'Color palette to use (map exactly to the roles described in the system prompt):\n' +
    `\`\`\`json\n${serializeColorScheme(request.colorScheme)}\n\`\`\`` +
    `${typeHint}\n\n` +
    `${requestBlock}\n` +
    '--- PAPER SECTIONS ---\n\n' +
    `${sectionText}\n\n` +
    '--- END OF PAPER ---\n\n' +
    `${countHint}` +
    "Generate figure prompts that best match the user's request and the paper. " +
    'If no explicit user request is provided, generate one figure prompt per major section above. ' +
    "Never include rulers, margin guides, or any visible measurement text like '16px', '0.5pt', or '75%'. " +
    'Return ONLY valid JSON array as specified in the system prompt. ' +
    'Each prompt field must be at least 500 words and extremely precise.'
  );
}

function buildTemplateUserPrompt(request: ClaudeRequest): string {
  const colorBlock = serializeColorScheme(request.colorScheme);
  const countHint = request.maxCount > 0 ? `Generate exactly ${request.maxCount} template figure(s). ` : 'Generate 1 template figure. ';

  let typeHint = '';
  if (request.requestedFigureTypes.length > 0) {
    const typeDescriptions = request.requestedFigureTypes
      .filter((figureType) => figureType in FIGURE_TYPES)
      .map((figureType) => `- ${figureType}: ${FIGURE_TYPES[figureType].description}`);
    if (typeDescriptions.length > 0) {
      typeHint = `\n\nUse these figure types:\n${typeDescriptions.join('\n')}`;
    }
  }

  return (
    'Color palette to use (map exactly to the roles described in the system prompt):\n' +
    `\`\`\`json\n${colorBlock}\n\`\`\`` +
    `${typeHint}\n\n` +
    `${countHint}` +
    'Generate purely structural, text-free layout template(s). ' +
    'Do NOT include any text, labels, annotations, numbers, or symbols of any kind. ' +
    'Every element must be a shape, line, or arrow only. ' +
    'Return ONLY valid JSON array as specified in the system prompt.'
  );
}

function parseClaudeContent(rawText: string): ClaudeFigureDraft[] {
  let text = rawText.trim();
  if (text.startsWith('```')) {
    const lines = text.split('\n');
    const innerLines = lines.slice(1);
    if (innerLines.length > 0 && innerLines[innerLines.length - 1].trim() === '```') {
      innerLines.pop();
    }
    text = innerLines.join('\n').trim();
  }

  const direct = tryParseArray(text);
  if (direct) return direct;

  const match = text.match(/\[[\s\S]*\]/);
  return match ? tryParseArray(match[0]) ?? [] : [];
}

function tryParseArray(text: string): ClaudeFigureDraft[] | undefined {
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!Array.isArray(parsed)) return undefined;
    return parsed.map((item, index) => normalizeFigure(item, index)).filter((item): item is ClaudeFigureDraft => Boolean(item));
  } catch {
    return undefined;
  }
}

function normalizeFigure(input: unknown, index: number): ClaudeFigureDraft | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const candidate = input as Record<string, unknown>;
  const prompt = String(candidate.prompt ?? '').trim();
  if (!prompt) return undefined;
  const figureType = String(candidate.suggested_figure_type ?? candidate.figure_type ?? 'overall_framework') as FigureType;
  return {
    figure_number: Number(candidate.figure_number ?? index + 1),
    title: String(candidate.title ?? `Figure ${index + 1}`),
    suggested_figure_type: figureType,
    suggested_aspect_ratio: String(candidate.suggested_aspect_ratio ?? '16:9'),
    prompt,
    source_section_titles: Array.isArray(candidate.source_section_titles) ? candidate.source_section_titles.map((item) => String(item)) : [],
    rationale: String(candidate.rationale ?? ''),
  };
}

function normalizeClaudeApiUrl(baseOrFull?: string): string {
  const defaultUrl = 'https://api.anthropic.com/v1/messages';
  if (!baseOrFull) return defaultUrl;
  let url = baseOrFull.trim();
  if (!url) return defaultUrl;
  url = url.replace(/\/+$/, '');
  if (url.endsWith('/v1/messages')) return url;
  return `${url}/v1/messages`;
}

export async function generateClaudePrompts(request: ClaudeRequest): Promise<ClaudeResponse> {
  const endpoint = normalizeClaudeApiUrl(request.secureSettings.claudeBaseUrl);
  const startedAt = performance.now();
  const response = await apiFetch(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': request.secureSettings.claudeApiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: request.secureSettings.claudeModel,
      max_tokens: 8192,
      system: request.templateMode ? TEMPLATE_FIGURE_SYSTEM_PROMPT : ACADEMIC_FIGURE_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: request.templateMode ? buildTemplateUserPrompt(request) : buildUserPrompt(request) }],
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Claude API 请求失败 (${response.status})：${detail.slice(0, 300)}`);
  }

  const result = (await response.json()) as {
    content?: Array<{ type: string; text?: string }>;
    usage?: { input_tokens?: number; output_tokens?: number };
  };

  const text = (result.content ?? []).filter((item) => item.type === 'text').map((item) => item.text ?? '').join('');

  return {
    figures: parseClaudeContent(text).slice(0, request.maxCount),
    inputTokens: result.usage?.input_tokens ?? 0,
    outputTokens: result.usage?.output_tokens ?? 0,
    model: request.secureSettings.claudeModel,
    durationMs: Math.round(performance.now() - startedAt),
  };
}
