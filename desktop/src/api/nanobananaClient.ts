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

function buildGenerationPayload(promptText: string, aspectRatio: AspectRatio, imageSize: Resolution, colorScheme: string): {
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
  return {
    contents: [{ parts: [{ text: fullPrompt }] }],
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

export async function generateNanoImage(request: NanoRequest): Promise<NanoResponse> {
  const { width, height } = computeDimensions(request.resolution, request.aspectRatio);
  const endpoint = `${request.secureSettings.nanobananaBaseUrl.replace(/\/+$/, '')}/v1beta/models/gemini-3-pro-image-preview:generateContent`;
  const startedAt = performance.now();
  const promptText = request.editInstruction ? `${request.editInstruction}\n\nOriginal prompt context:\n${request.prompt}` : request.prompt;
  const payload = buildGenerationPayload(promptText, request.aspectRatio, request.resolution, request.colorScheme);

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      Authorization: `Bearer ${request.secureSettings.nanobananaApiKey}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`NanoBanana API 请求失败 (${response.status})：${detail.slice(0, 300)}`);
  }

  const result = (await response.json()) as {
    candidates?: Array<{
      content?: {
        parts?: Array<{
          inlineData?: {
            data?: string;
          };
        }>;
      };
    }>;
  };
  const parts = result.candidates?.[0]?.content?.parts ?? [];
  const base64 = parts.find((part) => part.inlineData?.data)?.inlineData?.data;
  if (!base64?.trim()) {
    throw new Error(`NanoBanana response missing image data: ${JSON.stringify(result).slice(0, 500)}`);
  }

  return {
    previewDataUrl: `data:image/png;base64,${base64}`,
    finalPromptSent: payload.fullPrompt,
    endpoint,
    width,
    height,
    durationMs: Math.round(performance.now() - startedAt),
    fileSizeBytes: Math.floor((base64.length * 3) / 4),
  };
}
