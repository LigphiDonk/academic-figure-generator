import { apiFetch } from '../lib/apiFetch';
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
  const area = basePx * basePx;
  // height = sqrt(area * rh / rw), width = height * rw / rh
  let height = Math.sqrt(area * rh / rw);
  let width = height * rw / rh;
  // Round to nearest multiple of 8
  width = Math.max(8, Math.round(width / 8) * 8);
  height = Math.max(8, Math.round(height / 8) * 8);
  return { width, height };
}

/**
 * Generate an image via the NanoBanana API using OpenAI-compatible format.
 * 
 * This matches the backend's image_service.py implementation:
 * - Endpoint: POST /v1/images/generations
 * - Body: { model, prompt, n, size, aspect_ratio, response_format }
 * - Auth: Bearer token
 * - Response: { data: [{ b64_json }] }
 */
export async function generateNanoImage(request: NanoRequest): Promise<NanoResponse> {
  const { width, height } = computeDimensions(request.resolution, request.aspectRatio);
  const sizeStr = `${width}x${height}`;
  const baseUrl = request.secureSettings.nanobananaBaseUrl.replace(/\/+$/, '');
  const endpoint = `${baseUrl}/v1/images/generations`;
  const model = request.secureSettings.nanobananaModel || 'gemini-2.0-flash-exp-image-generation';

  const stylePrefix =
    'Academic figure, publication-quality, white background, clean vector style, ' +
    'no shadows, no 3D effects, professional sans-serif labels, ' +
    `color scheme: ${request.colorScheme}. `;
  const promptText = request.editInstruction
    ? `${request.editInstruction}\n\nOriginal prompt context:\n${request.prompt}`
    : request.prompt;
  const fullPrompt = stylePrefix + promptText;

  // Build OpenAI-compatible body (matches backend image_service.py)
  const body: Record<string, unknown> = {
    model,
    prompt: fullPrompt,
    n: 1,
    size: sizeStr,
    aspect_ratio: request.aspectRatio,
    response_format: 'b64_json',
  };

  // If reference image, encode and include
  if (request.referenceImage) {
    const arrayBuffer = await request.referenceImage.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    let binary = '';
    for (const byte of bytes) {
      binary += String.fromCharCode(byte);
    }
    body.image = btoa(binary);
  }

  const startedAt = performance.now();

  const response = await apiFetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${request.secureSettings.nanobananaApiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`NanoBanana API 请求失败 (${response.status})：${detail.slice(0, 300)}`);
  }

  const result = (await response.json()) as {
    data?: Array<{
      b64_json?: string;
      url?: string;
    }>;
  };

  const dataList = result.data ?? [];
  if (dataList.length === 0) {
    throw new Error('NanoBanana 返回数据为空，请检查 API Key 和 Base URL 配置');
  }

  const imageData = dataList[0];
  const base64 = imageData.b64_json ?? '';
  if (!base64.trim()) {
    // Fallback: try URL if b64_json is empty
    if (imageData.url) {
      return {
        previewDataUrl: imageData.url,
        finalPromptSent: fullPrompt,
        endpoint,
        width,
        height,
        durationMs: Math.round(performance.now() - startedAt),
        fileSizeBytes: 0,
      };
    }
    throw new Error(`NanoBanana 返回的图片数据为空: ${JSON.stringify(result).slice(0, 500)}`);
  }

  return {
    previewDataUrl: `data:image/png;base64,${base64}`,
    finalPromptSent: fullPrompt,
    endpoint,
    width,
    height,
    durationMs: Math.round(performance.now() - startedAt),
    fileSizeBytes: Math.floor((base64.length * 3) / 4),
  };
}
