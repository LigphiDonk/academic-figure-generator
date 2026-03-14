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
  const stylePrefix =
    'Academic figure, publication-quality, white background, clean vector style, ' +
    'no shadows, no 3D effects, professional sans-serif labels, ' +
    `color scheme: ${colorScheme}. `;
  const fullPrompt = stylePrefix + promptText;
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
        };
      }>;
    };
    finishReason?: string;
    finishMessage?: string;
  }>;
}

function extractBase64FromCandidates(
  candidates: NanoApiResult['candidates'],
): string | undefined {
  const parts = candidates?.flatMap((candidate) => candidate.content?.parts ?? []) ?? [];
  return parts.find((part) => part.inlineData?.data)?.inlineData?.data;
}

function extractBase64FromResult(result: NanoApiResult): string | undefined {
  return extractBase64FromCandidates(result.candidates);
}

function shouldRetryWithToolArgs(result: NanoApiResult): boolean {
  const candidate = result.candidates?.[0];
  const finishReason = String(candidate?.finishReason ?? '');
  const finishMessage = String(candidate?.finishMessage ?? '');
  return finishReason === 'MALFORMED_FUNCTION_CALL' || /google:image_gen|Malformed function call/i.test(finishMessage);
}

interface NanoRequestOptions {
  onProgress?: (progress: NanoGenerationProgress) => void;
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
        eventCount += 1;
        const hasImage = Boolean(extractBase64FromResult(payloadData));
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
        result: latestResult,
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

  let payload = buildGenerationPayload(promptText, request.aspectRatio, request.resolution, request.colorScheme);
  let requestResult = await runRequest(payload);
  let result = requestResult.result;
  let finalEndpoint = requestResult.endpoint;
  let base64 = extractBase64FromResult(result);
  if (!base64?.trim() && shouldRetryWithToolArgs(result)) {
    emitProgress({
      phase: 'retrying',
      message: '首次响应需要重试，正在切换兼容请求格式...',
    });
    payload = buildGenerationPayload(promptText, request.aspectRatio, request.resolution, request.colorScheme, 'tool-args');
    requestResult = await runRequest(payload);
    result = requestResult.result;
    finalEndpoint = requestResult.endpoint;
    base64 = extractBase64FromResult(result);
  }

  if (!base64?.trim()) {
    throw new Error(`NanoBanana 返回的图片数据为空: ${JSON.stringify(result).slice(0, 500)}`);
  }

  emitProgress({
    phase: 'completed',
    message: '图片数据已准备完成',
  });

  return {
    previewDataUrl: `data:image/png;base64,${base64}`,
    finalPromptSent: payload.fullPrompt,
    endpoint: finalEndpoint,
    width,
    height,
    durationMs: Math.round(performance.now() - startedAt),
    fileSizeBytes: Math.floor((base64.length * 3) / 4),
  };
}
