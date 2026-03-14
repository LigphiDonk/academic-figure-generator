import { FIGURE_TYPES } from '../core/prompts/figureTypes';
import { ACADEMIC_FIGURE_SYSTEM_PROMPT, TEMPLATE_FIGURE_SYSTEM_PROMPT } from '../core/prompts/systemPrompt';
import { apiFetch } from '../lib/apiFetch';
import { readSseStream } from '../lib/sse';
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
  rawText: string;
  inputTokens: number;
  outputTokens: number;
  model: string;
  durationMs: number;
}

export interface ClaudeStreamUpdate {
  event: string;
  rawText: string;
  inputTokens: number;
  outputTokens: number;
  model: string;
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

interface ClaudeStreamOptions {
  onUpdate?: (update: ClaudeStreamUpdate) => void;
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

function emitUpdate(
  options: ClaudeStreamOptions | undefined,
  update: ClaudeStreamUpdate,
): void {
  options?.onUpdate?.(update);
}

async function readJsonResponse(
  response: Response,
  request: ClaudeRequest,
  startedAt: number,
  options?: ClaudeStreamOptions,
): Promise<ClaudeResponse> {
  let result: {
    content?: Array<{ type: string; text?: string }>;
    usage?: { input_tokens?: number; output_tokens?: number };
    model?: string;
  };
  try {
    result = (await response.json()) as typeof result;
  } catch (jsonError) {
    console.error('[claudeClient] JSON parse failed:', jsonError);
    throw new Error('Claude API 响应解析失败：返回内容不是有效的 JSON');
  }

  const text = (result.content ?? []).filter((item) => item.type === 'text').map((item) => item.text ?? '').join('');
  const update = {
    event: 'message_stop',
    rawText: text,
    inputTokens: result.usage?.input_tokens ?? 0,
    outputTokens: result.usage?.output_tokens ?? 0,
    model: result.model ?? request.secureSettings.claudeModel,
  } satisfies ClaudeStreamUpdate;
  emitUpdate(options, update);

  return {
    figures: parseClaudeContent(text).slice(0, request.maxCount),
    rawText: text,
    inputTokens: update.inputTokens,
    outputTokens: update.outputTokens,
    model: update.model,
    durationMs: Math.round(performance.now() - startedAt),
  };
}

export async function generateClaudePrompts(
  request: ClaudeRequest,
  options?: ClaudeStreamOptions,
): Promise<ClaudeResponse> {
  const endpoint = normalizeClaudeApiUrl(request.secureSettings.claudeBaseUrl);
  const startedAt = performance.now();

  let response: Response;
  try {
    response = await apiFetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': request.secureSettings.claudeApiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: request.secureSettings.claudeModel,
        max_tokens: 8192,
        stream: true,
        system: request.templateMode ? TEMPLATE_FIGURE_SYSTEM_PROMPT : ACADEMIC_FIGURE_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: request.templateMode ? buildTemplateUserPrompt(request) : buildUserPrompt(request) }],
      }),
    });
  } catch (fetchError) {
    const msg = fetchError instanceof Error ? fetchError.message : String(fetchError);
    console.error('[claudeClient] fetch failed:', fetchError);
    throw new Error(`Claude API 网络请求失败：${msg}`);
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => '(无法读取响应)');
    throw new Error(`Claude API 请求失败 (${response.status})：${detail.slice(0, 300)}`);
  }

  const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
  if (!contentType.includes('text/event-stream')) {
    return readJsonResponse(response, request, startedAt, options);
  }

  if (!response.body) {
    throw new Error('Claude API 返回了空响应流');
  }

  const streamState: ClaudeStreamUpdate = {
    event: 'message_start',
    rawText: '',
    inputTokens: 0,
    outputTokens: 0,
    model: request.secureSettings.claudeModel,
  };

  try {
    await readSseStream(response.body, (message) => {
      if (!message.data.trim() || message.event === 'ping') return;

      let payload: Record<string, unknown>;
      try {
        payload = JSON.parse(message.data) as Record<string, unknown>;
      } catch (parseError) {
        console.error('[claudeClient] SSE payload parse failed:', parseError, message.data);
        throw new Error('Claude API 流式响应解析失败：收到无效事件数据');
      }

      if (message.event === 'error') {
        const error = payload.error as { message?: string } | undefined;
        throw new Error(`Claude API 流式响应异常：${error?.message ?? message.data}`);
      }

      if (message.event === 'message_start') {
        const messagePayload = payload.message as {
          model?: string;
          usage?: { input_tokens?: number; output_tokens?: number };
        } | undefined;
        streamState.model = messagePayload?.model ?? streamState.model;
        streamState.inputTokens = messagePayload?.usage?.input_tokens ?? streamState.inputTokens;
        streamState.outputTokens = messagePayload?.usage?.output_tokens ?? streamState.outputTokens;
      }

      if (message.event === 'content_block_start') {
        const contentBlock = payload.content_block as { type?: string; text?: string } | undefined;
        if (contentBlock?.type === 'text' && contentBlock.text) {
          streamState.rawText += contentBlock.text;
        }
      }

      if (message.event === 'content_block_delta') {
        const delta = payload.delta as { type?: string; text?: string } | undefined;
        if (delta?.type === 'text_delta' && delta.text) {
          streamState.rawText += delta.text;
        }
      }

      if (message.event === 'message_delta') {
        const usage = payload.usage as { input_tokens?: number; output_tokens?: number } | undefined;
        if (typeof usage?.input_tokens === 'number') streamState.inputTokens = usage.input_tokens;
        if (typeof usage?.output_tokens === 'number') streamState.outputTokens = usage.output_tokens;
      }

      streamState.event = message.event;
      emitUpdate(options, { ...streamState });
    });
  } catch (streamError) {
    const message = streamError instanceof Error ? streamError.message : String(streamError);
    throw new Error(`Claude API 流式请求失败：${message}`);
  }

  return {
    figures: parseClaudeContent(streamState.rawText).slice(0, request.maxCount),
    rawText: streamState.rawText,
    inputTokens: streamState.inputTokens,
    outputTokens: streamState.outputTokens,
    model: streamState.model,
    durationMs: Math.round(performance.now() - startedAt),
  };
}
