import type { DocumentRecord, DocumentSection } from '../types/models';
import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import { isoNow, wordCount } from '../lib/utils';
import { mutateSnapshot, readSnapshot } from './storage';
import { projectService } from './projectService';

type PdfJsModule = {
  GlobalWorkerOptions: {
    workerSrc: string;
    workerPort?: Worker | null;
  };
  getDocument: (input: { data: Uint8Array }) => {
    promise: Promise<{
      numPages: number;
      getPage: (pageNumber: number) => Promise<{
        getTextContent: () => Promise<{ items: unknown[] }>;
        streamTextContent: (params?: Record<string, unknown>) => ReadableStream<{ items: unknown[]; styles: unknown; lang: string | null }>;
      }>;
    }>;
  };
};

type MammothModule = {
  extractRawText: (input: { arrayBuffer: ArrayBuffer }) => Promise<{ value: string }>;
};

type PromiseWithResolversResult<T> = {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
};

type PromiseWithResolversCtor = PromiseConstructor & {
  withResolvers?: <T>() => PromiseWithResolversResult<T>;
};

type MapWithUpsert<K, V> = Map<K, V> & {
  getOrInsert?: (key: K, value: V) => V;
  getOrInsertComputed?: (key: K, compute: (key: K) => V) => V;
};

type WeakMapWithUpsert<K extends object, V> = WeakMap<K, V> & {
  getOrInsert?: (key: K, value: V) => V;
  getOrInsertComputed?: (key: K, compute: (key: K) => V) => V;
};

type UrlCtorWithCompat = typeof URL & {
  parse?: (url: string, base?: string | URL) => URL | null;
  canParse?: (url: string, base?: string | URL) => boolean;
};

type ArrayPrototypeWithCompat = unknown[] & {
  at?: (index: number) => unknown;
  findLast?: (predicate: (value: unknown, index: number, array: unknown[]) => boolean, thisArg?: unknown) => unknown;
};

let pdfjsModulePromise: Promise<PdfJsModule> | undefined;
let pdfjsWorkerPort: Worker | undefined;
let pdfjsWorkerBootstrapUrl: string | undefined;
let configuredPdfWorkerUrl: string | undefined;

function getPdfTextItemString(item: unknown): string {
  if (typeof item !== 'object' || item === null) return '';
  if (!('str' in item)) return '';
  return typeof item.str === 'string' ? item.str : '';
}

function ensurePromiseWithResolvers(): void {
  const promiseCtor = Promise as PromiseWithResolversCtor;
  if (typeof promiseCtor.withResolvers === 'function') return;
  promiseCtor.withResolvers = function withResolvers<T>(): PromiseWithResolversResult<T> {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
}

function ensureMapUpsert(): void {
  const mapProto = Map.prototype as unknown as MapWithUpsert<unknown, unknown>;
  if (typeof mapProto.getOrInsert !== 'function') {
    Object.defineProperty(mapProto, 'getOrInsert', {
      configurable: true,
      writable: true,
      value(this: Map<unknown, unknown>, key: unknown, value: unknown) {
        if (this.has(key)) return this.get(key);
        this.set(key, value);
        return value;
      },
    });
  }
  if (typeof mapProto.getOrInsertComputed === 'function') return;
  Object.defineProperty(mapProto, 'getOrInsertComputed', {
    configurable: true,
    writable: true,
    value(this: Map<unknown, unknown>, key: unknown, compute: (key: unknown) => unknown) {
      if (this.has(key)) return this.get(key);
      const value = compute(key);
      this.set(key, value);
      return value;
    },
  });
}

function ensureWeakMapUpsert(): void {
  const weakMapProto = WeakMap.prototype as unknown as WeakMapWithUpsert<object, unknown>;
  if (typeof weakMapProto.getOrInsert !== 'function') {
    Object.defineProperty(weakMapProto, 'getOrInsert', {
      configurable: true,
      writable: true,
      value(this: WeakMap<object, unknown>, key: object, value: unknown) {
        if (this.has(key)) return this.get(key);
        this.set(key, value);
        return value;
      },
    });
  }
  if (typeof weakMapProto.getOrInsertComputed === 'function') return;
  Object.defineProperty(weakMapProto, 'getOrInsertComputed', {
    configurable: true,
    writable: true,
    value(this: WeakMap<object, unknown>, key: object, compute: (key: object) => unknown) {
      if (this.has(key)) return this.get(key);
      const value = compute(key);
      this.set(key, value);
      return value;
    },
  });
}

function ensureArrayCompat(): void {
  const arrayProto = Array.prototype as unknown as ArrayPrototypeWithCompat;
  if (typeof arrayProto.at !== 'function') {
    Object.defineProperty(arrayProto, 'at', {
      configurable: true,
      writable: true,
      value(this: unknown[], index: number) {
        const length = this.length >>> 0;
        let relativeIndex = Number(index) || 0;
        if (relativeIndex < 0) relativeIndex += length;
        if (relativeIndex < 0 || relativeIndex >= length) return undefined;
        return this[relativeIndex];
      },
    });
  }
  if (typeof arrayProto.findLast === 'function') return;
  Object.defineProperty(arrayProto, 'findLast', {
    configurable: true,
    writable: true,
    value(this: unknown[], predicate: (value: unknown, index: number, array: unknown[]) => boolean, thisArg?: unknown) {
      if (typeof predicate !== 'function') throw new TypeError('predicate must be a function');
      for (let index = this.length - 1; index >= 0; index -= 1) {
        const value = this[index];
        if (predicate.call(thisArg, value, index, this)) return value;
      }
      return undefined;
    },
  });
}

function ensureUrlCompat(): void {
  const urlCtor = URL as UrlCtorWithCompat;
  if (typeof urlCtor.parse !== 'function') {
    urlCtor.parse = (url: string, base?: string | URL) => {
      try {
        return new URL(url, base);
      } catch {
        return null;
      }
    };
  }
  if (typeof urlCtor.canParse === 'function') return;
  urlCtor.canParse = (url: string, base?: string | URL) => {
    try {
      new URL(url, base);
      return true;
    } catch {
      return false;
    }
  };
}

function ensurePdfJsCompat(): void {
  ensurePromiseWithResolvers();
  ensureMapUpsert();
  ensureWeakMapUpsert();
  ensureArrayCompat();
  ensureUrlCompat();
}

function createPdfJsWorkerBootstrapSource(workerUrl: string): string {
  const quotedWorkerUrl = JSON.stringify(workerUrl);
  return `
const promiseCtor = Promise;
if (typeof promiseCtor.withResolvers !== 'function') {
  promiseCtor.withResolvers = function withResolvers() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
}
const mapProto = Map.prototype;
if (typeof mapProto.getOrInsert !== 'function') {
  Object.defineProperty(mapProto, 'getOrInsert', {
    configurable: true,
    writable: true,
    value(key, value) {
      if (this.has(key)) return this.get(key);
      this.set(key, value);
      return value;
    },
  });
}
if (typeof mapProto.getOrInsertComputed !== 'function') {
  Object.defineProperty(mapProto, 'getOrInsertComputed', {
    configurable: true,
    writable: true,
    value(key, compute) {
      if (this.has(key)) return this.get(key);
      const value = compute(key);
      this.set(key, value);
      return value;
    },
  });
}
const weakMapProto = WeakMap.prototype;
if (typeof weakMapProto.getOrInsert !== 'function') {
  Object.defineProperty(weakMapProto, 'getOrInsert', {
    configurable: true,
    writable: true,
    value(key, value) {
      if (this.has(key)) return this.get(key);
      this.set(key, value);
      return value;
    },
  });
}
if (typeof weakMapProto.getOrInsertComputed !== 'function') {
  Object.defineProperty(weakMapProto, 'getOrInsertComputed', {
    configurable: true,
    writable: true,
    value(key, compute) {
      if (this.has(key)) return this.get(key);
      const value = compute(key);
      this.set(key, value);
      return value;
    },
  });
}
if (typeof Array.prototype.at !== 'function') {
  Object.defineProperty(Array.prototype, 'at', {
    configurable: true,
    writable: true,
    value(index) {
      const length = this.length >>> 0;
      let relativeIndex = Number(index) || 0;
      if (relativeIndex < 0) relativeIndex += length;
      if (relativeIndex < 0 || relativeIndex >= length) return undefined;
      return this[relativeIndex];
    },
  });
}
if (typeof Array.prototype.findLast !== 'function') {
  Object.defineProperty(Array.prototype, 'findLast', {
    configurable: true,
    writable: true,
    value(predicate, thisArg) {
      if (typeof predicate !== 'function') {
        throw new TypeError('predicate must be a function');
      }
      for (let index = this.length - 1; index >= 0; index -= 1) {
        const value = this[index];
        if (predicate.call(thisArg, value, index, this)) return value;
      }
      return undefined;
    },
  });
}
if (typeof URL.parse !== 'function') {
  Object.defineProperty(URL, 'parse', {
    configurable: true,
    writable: true,
    value(url, base) {
      try {
        return new URL(url, base);
      } catch {
        return null;
      }
    },
  });
}
if (typeof URL.canParse !== 'function') {
  Object.defineProperty(URL, 'canParse', {
    configurable: true,
    writable: true,
    value(url, base) {
      try {
        new URL(url, base);
        return true;
      } catch {
        return false;
      }
    },
  });
}
import ${quotedWorkerUrl};
`;
}

function teardownPdfJsWorker(): void {
  if (pdfjsWorkerPort) {
    pdfjsWorkerPort.terminate();
    pdfjsWorkerPort = undefined;
  }
  if (pdfjsWorkerBootstrapUrl) {
    URL.revokeObjectURL(pdfjsWorkerBootstrapUrl);
    pdfjsWorkerBootstrapUrl = undefined;
  }
  configuredPdfWorkerUrl = undefined;
}

function configurePdfJsWorker(pdfjs: PdfJsModule): void {
  const workerUrl = new URL(pdfWorkerUrl, window.location.href).href;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

  if (typeof Worker !== 'function' || typeof Blob !== 'function' || typeof URL.createObjectURL !== 'function') {
    pdfjs.GlobalWorkerOptions.workerPort = null;
    return;
  }

  if (configuredPdfWorkerUrl !== workerUrl) {
    teardownPdfJsWorker();
  }

  if (!pdfjsWorkerPort) {
    try {
      const bootstrapSource = createPdfJsWorkerBootstrapSource(workerUrl);
      pdfjsWorkerBootstrapUrl = URL.createObjectURL(new Blob([bootstrapSource], { type: 'text/javascript' }));
      pdfjsWorkerPort = new Worker(pdfjsWorkerBootstrapUrl, { type: 'module' });
      configuredPdfWorkerUrl = workerUrl;
    } catch {
      teardownPdfJsWorker();
    }
  }

  pdfjs.GlobalWorkerOptions.workerPort = pdfjsWorkerPort ?? null;
}

async function loadPdfJs(): Promise<PdfJsModule> {
  if (!pdfjsModulePromise) {
    ensurePdfJsCompat();
    pdfjsModulePromise = import('pdfjs-dist/legacy/build/pdf.mjs').then((module) => {
      const pdfjs = module as unknown as PdfJsModule;
      configurePdfJsWorker(pdfjs);
      return pdfjs;
    });
  }
  return pdfjsModulePromise;
}

function splitTextIntoSections(text: string): DocumentSection[] {
  const blocks = text.split(/\n{2,}/).map((item) => item.trim()).filter(Boolean);
  if (blocks.length === 0) return [];
  return blocks.map((block, index) => {
    const lines = block.split('\n').map((line) => line.trim()).filter(Boolean);
    const title = lines[0]?.length && lines[0]!.length < 90 ? lines[0]! : `Section ${index + 1}`;
    const content = title === lines[0] ? lines.slice(1).join('\n') || lines[0]! : block;
    return {
      title,
      content,
      level: /^\d+(?:\.\d+)+/.test(title) ? title.split('.').length : 1,
    };
  });
}

async function readStreamViaReader<T>(stream: ReadableStream<T>): Promise<T[]> {
  const reader = stream.getReader();
  const chunks: T[] = [];
  for (; ;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  return chunks;
}

async function parsePdfFile(file: File): Promise<{ parsedText: string; sections: DocumentSection[] }> {
  try {
    const pdfjs = await loadPdfJs();
    const bytes = new Uint8Array(await file.arrayBuffer());
    const pdf = await pdfjs.getDocument({ data: bytes }).promise;
    const pages = await Promise.all(
      Array.from({ length: pdf.numPages }, async (_, index) => {
        const page = await pdf.getPage(index + 1);
        // Use streamTextContent + manual reader instead of getTextContent()
        // because getTextContent() internally uses `for await...of` on a
        // ReadableStream, and Tauri's WebKit webview does not support
        // ReadableStream[Symbol.asyncIterator].
        const stream = page.streamTextContent();
        const chunks = await readStreamViaReader(stream);
        const allItems: unknown[] = [];
        for (const chunk of chunks) {
          if (chunk?.items) allItems.push(...chunk.items);
        }
        return allItems.map(getPdfTextItemString).join(' ').trim();
      }),
    );
    const parsedText = pages.filter(Boolean).join('\n\n');
    return { parsedText, sections: splitTextIntoSections(parsedText) };
  } catch (error) {
    console.error('Failed to parse PDF document', error);
    const message = error instanceof Error ? error.message : '未知错误';
    throw new Error(`PDF 解析失败：${message}`);
  }
}

async function parseDocxFile(file: File): Promise<{ parsedText: string; sections: DocumentSection[] }> {
  const mammoth = (await import('mammoth')) as unknown as MammothModule;
  const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
  const parsedText = result.value.trim();
  return { parsedText, sections: splitTextIntoSections(parsedText) };
}

export class DocumentService {
  async listDocuments(projectId: string): Promise<DocumentRecord[]> {
    const snapshot = await readSnapshot();
    return snapshot.documents.filter((item) => item.projectId === projectId).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async getDocument(id: string): Promise<DocumentRecord | null> {
    const snapshot = await readSnapshot();
    return snapshot.documents.find((item) => item.id === id) ?? null;
  }

  async uploadDocuments(projectId: string, files: File[]): Promise<DocumentRecord[]> {
    const documents = await Promise.all(
      files.map(async (file) => {
        const extension = file.name.split('.').pop()?.toLowerCase();
        if (!extension || !['pdf', 'docx', 'txt'].includes(extension)) throw new Error(`不支持的文件类型：${file.name}`);
        const timestamp = isoNow();
        const id = crypto.randomUUID();
        const fileType = extension as 'pdf' | 'docx' | 'txt';
        let parsedText = '';
        let sections: DocumentSection[] = [];
        let parseStatus: DocumentRecord['parseStatus'] = 'completed';
        let parseError: string | undefined;
        if (fileType === 'txt') {
          parsedText = await file.text();
          sections = splitTextIntoSections(parsedText);
        } else if (fileType === 'pdf') {
          ({ parsedText, sections } = await parsePdfFile(file));
        } else if (fileType === 'docx') {
          ({ parsedText, sections } = await parseDocxFile(file));
        } else {
          parseStatus = 'failed';
          parseError = `不支持的文件类型：${fileType}`;
        }
        if (sections.length === 0) {
          parseStatus = 'failed';
          parseError = parseError ?? `未能从 ${file.name} 中提取可用内容`;
        }
        return {
          id,
          projectId,
          filename: file.name,
          fileType,
          filePath: `documents/${projectId}/${id}.${extension}`,
          fileSizeBytes: file.size,
          wordCount: wordCount(parsedText),
          parsedText: parsedText || undefined,
          sections,
          ocrApplied: false,
          parseStatus,
          parseError,
          createdAt: timestamp,
          updatedAt: timestamp,
        } satisfies DocumentRecord;
      }),
    );

    await mutateSnapshot((snapshot) => {
      snapshot.documents.push(...documents);
    });
    await projectService.touchProject(projectId);
    return documents;
  }

  async deleteDocument(id: string): Promise<void> {
    const current = await this.getDocument(id);
    if (!current) return;
    await mutateSnapshot((snapshot) => {
      snapshot.documents = snapshot.documents.filter((item) => item.id !== id);
      snapshot.prompts = snapshot.prompts.map((prompt) => (prompt.documentId === id ? { ...prompt, documentId: undefined } : prompt));
    });
    await projectService.touchProject(current.projectId);
  }
}

export const documentService = new DocumentService();
