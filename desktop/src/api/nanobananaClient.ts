import { apiFetch } from '../lib/apiFetch';
import { readSseStream } from '../lib/sse';
import type { AspectRatio, Resolution, SecureSettings } from '../types/models';

interface NanoRequest {
  secureSettings: SecureSettings;
  prompt: string;
  resolution: Resolution;
  aspectRatio: AspectRatio;
  colorScheme: string;
  referenceImage?: File;
  editInstruction?: string;
}

export interface NanoResponse {
  previewDataUrl: string;
  finalPromptSent: string;
  endpoint: string;
  mimeType: string;
  width: number;
  height: number;
  durationMs: number;
  fileSizeBytes: number;
}

export type NanoGenerationPhase = 'requesting' | 'streaming' | 'retrying' | 'decoding' | 'completed';

export interface NanoGenerationProgress {
  phase: NanoGenerationPhase;
  message: string;
}

const RESOLUTION_MAP: Record<Resolution, number> = {
  '1K': 1024,
  '2K': 2048,
  '4K': 4096,
};

const ASPECT_RATIO_MAP: Record<AspectRatio, [number, number]> = {
  '1:1': [1, 1],
  '4:3': [4, 3],
  '3:4': [3, 4],
  '16:9': [16, 9],
  '9:16': [9, 16],
  '3:2': [3, 2],
  '2:3': [2, 3],
};

function computeDimensions(resolution: Resolution, aspectRatio: AspectRatio): { width: number; height: number } {
  const basePx = RESOLUTION_MAP[resolution] ?? 2048;
  const [rw, rh] = ASPECT_RATIO_MAP[aspectRatio] ?? [1, 1];
  const ratio = rw / rh;
  let width: number;
  let height: number;
  if (ratio >= 1) {
    width = basePx;
    height = Math.floor(basePx / ratio);
  } else {
    height = basePx;
    width = Math.floor(basePx * ratio);
  }
  width = Math.floor(width / 64) * 64;
  height = Math.floor(height / 64) * 64;
  return { width, height };
}

/**
 * Build the Gemini-style API request payload for NanoBanana.
 *
 * Matches backend image_tasks.py `_build_generation_payload`:
 *   POST /v1beta/models/{model}:generateContent
 */
function buildStyledPrompt(promptText: string, colorScheme: string): string {
  const stylePrefix =
    'Academic figure, publication-quality, white background, clean vector style, ' +
    'no shadows, no 3D effects, professional sans-serif labels, ' +
    `color scheme: ${colorScheme}. `;
  return stylePrefix + promptText;
}

function buildGenerationPayload(
  promptText: string,
  aspectRatio: AspectRatio,
  imageSize: Resolution,
  colorScheme: string,
  promptMode: 'plain' | 'tool-args' = 'plain',
): {
  contents: Array<{ parts: Array<{ text: string }> }>;
  generationConfig: {
    responseModalities: ['IMAGE'];
    imageConfig: {
      aspectRatio: AspectRatio;
      image_size: Resolution;
    };
  };
  fullPrompt: string;
} {
  const fullPrompt = buildStyledPrompt(promptText, colorScheme);
  const text = promptMode === 'tool-args'
    ? JSON.stringify({ end_turn: true, prompt: fullPrompt })
    : fullPrompt;
  return {
    contents: [{ parts: [{ text }] }],
    generationConfig: {
      responseModalities: ['IMAGE'],
      imageConfig: {
        aspectRatio,
        image_size: imageSize,
      },
    },
    fullPrompt,
  };
}

interface NanoApiResult {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        inlineData?: {
          data?: string;
          mimeType?: string;
          mime_type?: string;
        };
        inline_data?: {
          data?: string;
          mimeType?: string;
          mime_type?: string;
        };
      }>;
    };
    finishReason?: string;
    finish_reason?: string;
    finishMessage?: string;
    finish_message?: string;
  }>;
  data?: Array<{
    b64_json?: string;
    b64Json?: string;
    url?: string;
    mimeType?: string;
    mime_type?: string;
  }>;
  image_base64?: string;
  mimeType?: string;
  mime_type?: string;
}

interface NanoImagePayload {
  kind: 'base64' | 'url';
  value: string;
  mimeType: string;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function isSameOrigin(targetUrl: string, baseUrl: string): boolean {
  try {
    return new URL(targetUrl).origin === new URL(baseUrl).origin;
  } catch {
    return false;
  }
}

async function fetchRemoteImageAsDataUrl(
  url: string,
  request: NanoRequest,
): Promise<{ previewDataUrl: string; mimeType: string; fileSizeBytes: number }> {
  if (url.startsWith('data:')) {
    const mimeType = url.match(/^data:([^;,]+)/i)?.[1] ?? 'image/png';
    const base64Part = url.split(',', 2)[1] ?? '';
    return {
      previewDataUrl: url,
      mimeType,
      fileSizeBytes: Math.floor((base64Part.length * 3) / 4),
    };
  }

  const headers = isSameOrigin(url, request.secureSettings.nanobananaBaseUrl)
    ? {
        Authorization: `Bearer ${request.secureSettings.nanobananaApiKey}`,
        'x-goog-api-key': request.secureSettings.nanobananaApiKey,
      }
    : undefined;

  const response = await apiFetch(url, headers ? { headers } : undefined);
  if (!response.ok) {
    const detail = await response.text().catch(() => '(无法读取响应)');
    throw new Error(`远程图片拉取失败 (${response.status})：${detail.slice(0, 300)}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  const mimeType = response.headers.get('content-type')?.split(';')[0]?.trim() || 'image/png';
  const base64 = bytesToBase64(new Uint8Array(arrayBuffer));
  return {
    previewDataUrl: `data:${mimeType};base64,${base64}`,
    mimeType,
    fileSizeBytes: arrayBuffer.byteLength,
  };
}

async function materializeImagePayload(
  payload: NanoImagePayload,
  request: NanoRequest,
): Promise<{ previewDataUrl: string; mimeType: string; fileSizeBytes: number }> {
  if (payload.kind === 'url') {
    return fetchRemoteImageAsDataUrl(payload.value, request);
  }
  return {
    previewDataUrl: `data:${payload.mimeType};base64,${payload.value}`,
    mimeType: payload.mimeType,
    fileSizeBytes: Math.floor((payload.value.length * 3) / 4),
  };
}

function extractImagePayloadFromCandidates(
  candidates: NanoApiResult['candidates'],
): NanoImagePayload | undefined {
  const parts = candidates?.flatMap((candidate) => candidate.content?.parts ?? []) ?? [];
  for (const part of parts) {
    const inline = part.inlineData ?? part.inline_data;
    const data = inline?.data?.trim();
    if (!data) continue;
    return {
      kind: 'base64',
      value: data,
      mimeType: inline?.mimeType ?? inline?.mime_type ?? 'image/png',
    };
  }
  return undefined;
}

function extractImagePayloadFromResult(result: NanoApiResult): NanoImagePayload | undefined {
  const geminiPayload = extractImagePayloadFromCandidates(result.candidates);
  if (geminiPayload) return geminiPayload;

  const openAiItem = result.data?.find((item) => Boolean(item.b64_json || item.b64Json || item.url));
  const base64 = openAiItem?.b64_json?.trim() || openAiItem?.b64Json?.trim() || result.image_base64?.trim();
  if (base64) {
    return {
      kind: 'base64',
      value: base64,
      mimeType: openAiItem?.mimeType ?? openAiItem?.mime_type ?? result.mimeType ?? result.mime_type ?? 'image/png',
    };
  }

  const url = openAiItem?.url?.trim();
  if (url) {
    return {
      kind: 'url',
      value: url,
      mimeType: openAiItem?.mimeType ?? openAiItem?.mime_type ?? 'image/png',
    };
  }

  return undefined;
}

function shouldRetryWithToolArgs(result: NanoApiResult): boolean {
  const candidate = result.candidates?.[0];
  const finishReason = String(candidate?.finishReason ?? candidate?.finish_reason ?? '');
  const finishMessage = String(candidate?.finishMessage ?? candidate?.finish_message ?? '');
  return finishReason === 'MALFORMED_FUNCTION_CALL' || /google:image_gen|Malformed function call/i.test(finishMessage);
}

interface NanoRequestOptions {
  onProgress?: (progress: NanoGenerationProgress) => void;
}

function buildOpenAiCompatiblePayload(
  model: string,
  promptText: string,
  resolution: Resolution,
  aspectRatio: AspectRatio,
  colorScheme: string,
): {
  body: Record<string, unknown>;
  fullPrompt: string;
} {
  const { width, height } = computeDimensions(resolution, aspectRatio);
  const fullPrompt = buildStyledPrompt(promptText, colorScheme);
  return {
    body: {
      model,
      prompt: fullPrompt,
      n: 1,
      size: `${width}x${height}`,
      aspect_ratio: aspectRatio,
      response_format: 'b64_json',
    },
    fullPrompt,
  };
}

/**
 * Generate an image via the NanoBanana API using Gemini-style format.
 *
 * This matches the backend's image_tasks.py `_call_nanobanana_api`:
 * - Endpoint: POST /v1beta/models/{model}:generateContent
 * - Body: { contents, generationConfig }
 * - Auth: Bearer token
 * - Response: { candidates[0].content.parts[].inlineData.data }
 */
export async function generateNanoImage(request: NanoRequest, options?: NanoRequestOptions): Promise<NanoResponse> {
  const emitProgress = (progress: NanoGenerationProgress) => {
    options?.onProgress?.(progress);
  };

  const { width, height } = computeDimensions(request.resolution, request.aspectRatio);
  const model = request.secureSettings.nanobananaModel || 'gemini-2.0-flash-exp-image-generation';
  const baseUrl = request.secureSettings.nanobananaBaseUrl.replace(/\/+$/, '');
  const streamEndpoint = `${baseUrl}/v1beta/models/${model}:streamGenerateContent?alt=sse`;
  const fallbackEndpoint = `${baseUrl}/v1beta/models/${model}:generateContent`;
  const openAiCompatEndpoint = `${baseUrl}/v1/images/generations`;
  const startedAt = performance.now();

  const promptText = request.editInstruction
    ? `${request.editInstruction}\n\nOriginal prompt context:\n${request.prompt}`
    : request.prompt;
  const sendRequest = async (
    payload: ReturnType<typeof buildGenerationPayload>,
    streamMode: boolean,
  ): Promise<{ result: NanoApiResult; endpoint: string }> => {
    emitProgress({
      phase: 'requesting',
      message: streamMode ? '正在向 NanoBanana 发起流式图片生成请求...' : '正在向 NanoBanana 发送图片生成请求...',
    });

    let response: Response;
    try {
      response = await apiFetch(streamMode ? streamEndpoint : fallbackEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${request.secureSettings.nanobananaApiKey}`,
          'x-goog-api-key': request.secureSettings.nanobananaApiKey,
        },
        body: JSON.stringify({
          contents: payload.contents,
          generationConfig: payload.generationConfig,
        }),
      });
    } catch (fetchError) {
      const msg = fetchError instanceof Error ? fetchError.message : String(fetchError);
      console.error('[nanobananaClient] fetch failed:', fetchError);
      throw new Error(`NanoBanana API 网络请求失败：${msg}`);
    }

    if (!response.ok) {
      const detail = await response.text().catch(() => '(无法读取响应)');
      throw new Error(`NanoBanana API 请求失败 (${response.status})：${detail.slice(0, 300)}`);
    }

    const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
    if (streamMode && contentType.includes('text/event-stream')) {
      if (!response.body) throw new Error('NanoBanana 返回了空响应流');

      let latestResult: NanoApiResult = {};
      let aggregatedCandidates: NonNullable<NanoApiResult['candidates']> = [];
      let eventCount = 0;
      await readSseStream(response.body, (message) => {
        const data = message.data.trim();
        if (!data || data === '[DONE]') return;
        let payloadData: NanoApiResult;
        try {
          payloadData = JSON.parse(data) as NanoApiResult;
        } catch (parseError) {
          console.error('[nanobananaClient] SSE payload parse failed:', parseError, data);
          throw new Error('NanoBanana 流式响应解析失败：收到无效事件数据');
        }

        latestResult = payloadData;
        if (payloadData.candidates?.length) {
          aggregatedCandidates = aggregatedCandidates.concat(payloadData.candidates);
        }
        eventCount += 1;
        const hasImage = Boolean(extractImagePayloadFromCandidates(aggregatedCandidates));
        emitProgress({
          phase: 'streaming',
          message: hasImage
            ? `NanoBanana 流式响应完成，已收到图片结果（事件 ${eventCount}）...`
            : `NanoBanana 正在流式返回结果（事件 ${eventCount}）...`,
        });
      });

      emitProgress({
        phase: 'decoding',
        message: '流式响应结束，正在解析最终图片数据...',
      });
      return {
        result: aggregatedCandidates.length > 0
          ? { ...latestResult, candidates: aggregatedCandidates }
          : latestResult,
        endpoint: streamEndpoint,
      };
    }

    emitProgress({
      phase: 'decoding',
      message: streamMode ? '上游未返回 SSE，正在按普通响应解析图片数据...' : '模型已返回响应，正在解析图片数据...',
    });

    try {
      return {
        result: (await response.json()) as NanoApiResult,
        endpoint: streamMode ? streamEndpoint : fallbackEndpoint,
      };
    } catch (jsonError) {
      console.error('[nanobananaClient] JSON parse failed:', jsonError);
      throw new Error('NanoBanana API 响应解析失败：返回内容不是有效的 JSON');
    }
  };

  const runRequest = async (
    nextPayload: ReturnType<typeof buildGenerationPayload>,
  ): Promise<{ result: NanoApiResult; endpoint: string }> => {
    try {
      return await sendRequest(nextPayload, true);
    } catch (streamError) {
      const message = streamError instanceof Error ? streamError.message : String(streamError);
      emitProgress({
        phase: 'retrying',
        message: `流式接口失败，正在回退普通接口：${message.slice(0, 120)}`,
      });
      return sendRequest(nextPayload, false);
    }
  };

  const sendOpenAiCompatibleRequest = async (): Promise<{ result: NanoApiResult; endpoint: string; fullPrompt: string }> => {
    const openAiPayload = buildOpenAiCompatiblePayload(
      model,
      promptText,
      request.resolution,
      request.aspectRatio,
      request.colorScheme,
    );
    emitProgress({
      phase: 'retrying',
      message: '正在回退到 OpenAI 兼容图片接口...',
    });

    let response: Response;
    try {
      response = await apiFetch(openAiCompatEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${request.secureSettings.nanobananaApiKey}`,
          'x-goog-api-key': request.secureSettings.nanobananaApiKey,
        },
        body: JSON.stringify(openAiPayload.body),
      });
    } catch (fetchError) {
      const msg = fetchError instanceof Error ? fetchError.message : String(fetchError);
      console.error('[nanobananaClient] openai-compatible fetch failed:', fetchError);
      throw new Error(`NanoBanana OpenAI 兼容接口请求失败：${msg}`);
    }

    if (!response.ok) {
      const detail = await response.text().catch(() => '(无法读取响应)');
      throw new Error(`NanoBanana OpenAI 兼容接口失败 (${response.status})：${detail.slice(0, 300)}`);
    }

    const result = (await response.json()) as NanoApiResult;
    return {
      result,
      endpoint: openAiCompatEndpoint,
      fullPrompt: openAiPayload.fullPrompt,
    };
  };

  let payload = buildGenerationPayload(promptText, request.aspectRatio, request.resolution, request.colorScheme);
  let requestResult = await runRequest(payload);
  let result = requestResult.result;
  let finalEndpoint = requestResult.endpoint;
  let imagePayload = extractImagePayloadFromResult(result);
  if (!imagePayload && shouldRetryWithToolArgs(result)) {
    emitProgress({
      phase: 'retrying',
      message: '首次响应需要重试，正在切换兼容请求格式...',
    });
    payload = buildGenerationPayload(promptText, request.aspectRatio, request.resolution, request.colorScheme, 'tool-args');
    requestResult = await runRequest(payload);
    result = requestResult.result;
    finalEndpoint = requestResult.endpoint;
    imagePayload = extractImagePayloadFromResult(result);
  }

  if (!imagePayload) {
    const openAiResult = await sendOpenAiCompatibleRequest();
    result = openAiResult.result;
    finalEndpoint = openAiResult.endpoint;
    imagePayload = extractImagePayloadFromResult(result);
    payload.fullPrompt = openAiResult.fullPrompt;
  }

  if (!imagePayload) {
    throw new Error(`NanoBanana 返回的图片数据为空: ${JSON.stringify(result).slice(0, 500)}`);
  }

  emitProgress({
    phase: 'completed',
    message: '图片数据已准备完成',
  });

  const materialized = await materializeImagePayload(imagePayload, request);

  return {
    previewDataUrl: materialized.previewDataUrl,
    finalPromptSent: payload.fullPrompt,
    endpoint: finalEndpoint,
    mimeType: materialized.mimeType,
    width,
    height,
    durationMs: Math.round(performance.now() - startedAt),
    fileSizeBytes: materialized.fileSizeBytes,
  };
}
