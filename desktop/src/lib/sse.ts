export interface SseMessage {
  event: string;
  data: string;
  id?: string;
}

function parseSseBlock(block: string): SseMessage | null {
  const lines = block.replace(/\r/g, '').split('\n');
  let event = 'message';
  let id: string | undefined;
  const dataLines: string[] = [];

  for (const line of lines) {
    if (!line || line.startsWith(':')) continue;
    const separatorIndex = line.indexOf(':');
    const field = separatorIndex >= 0 ? line.slice(0, separatorIndex) : line;
    const rawValue = separatorIndex >= 0 ? line.slice(separatorIndex + 1) : '';
    const value = rawValue.startsWith(' ') ? rawValue.slice(1) : rawValue;

    if (field === 'event') {
      event = value || 'message';
      continue;
    }
    if (field === 'data') {
      dataLines.push(value);
      continue;
    }
    if (field === 'id') {
      id = value;
    }
  }

  if (dataLines.length === 0) return null;
  return {
    event,
    data: dataLines.join('\n'),
    id,
  };
}

export async function readSseStream(
  stream: ReadableStream<Uint8Array>,
  onMessage: (message: SseMessage) => void | Promise<void>,
): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const normalized = buffer.replace(/\r/g, '');
      const frames = normalized.split('\n\n');
      buffer = frames.pop() ?? '';

      for (const frame of frames) {
        const message = parseSseBlock(frame);
        if (message) await onMessage(message);
      }
    }

    buffer += decoder.decode();
    const finalMessage = parseSseBlock(buffer);
    if (finalMessage) await onMessage(finalMessage);
  } finally {
    reader.releaseLock();
  }
}
