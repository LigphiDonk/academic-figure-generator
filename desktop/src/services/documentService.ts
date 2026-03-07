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

function ensurePdfJsCompat(): void {
  ensurePromiseWithResolvers();
  ensureMapUpsert();
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

async function parsePdfFile(file: File): Promise<{ parsedText: string; sections: DocumentSection[] }> {
  try {
    const pdfjs = await loadPdfJs();
    const bytes = new Uint8Array(await file.arrayBuffer());
    const pdf = await pdfjs.getDocument({ data: bytes }).promise;
    const pages = await Promise.all(
      Array.from({ length: pdf.numPages }, async (_, index) => {
        const page = await pdf.getPage(index + 1);
        const content = await page.getTextContent();
        return content.items.map(getPdfTextItemString).join(' ').trim();
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
