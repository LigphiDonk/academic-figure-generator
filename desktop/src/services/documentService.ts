import type { DocumentRecord, DocumentSection } from '../types/models';
import JSZip from 'jszip';
import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import { isoNow, wordCount } from '../lib/utils';
import { mutateSnapshot, readSnapshot } from './storage';
import { projectService } from './projectService';

export type DocumentUploadPhase = 'reading' | 'parsing' | 'saving' | 'completed';

export interface DocumentUploadProgress {
  phase: DocumentUploadPhase;
  current: number;
  total: number;
  fileName?: string;
  message: string;
}

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
const WORD_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

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

async function parsePdfFile(file: File): Promise<{ parsedText: string; sections: DocumentSection[]; pageTexts: string[] }> {
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
    return { parsedText, sections: splitTextIntoSections(parsedText), pageTexts: pages };
  } catch (error) {
    console.error('Failed to parse PDF document', error);
    const message = error instanceof Error ? error.message : '未知错误';
    throw new Error(`PDF 解析失败：${message}`);
  }
}

function getAttributeValue(node: Element, localName: string): string | null {
  for (const attr of Array.from(node.attributes)) {
    if (attr.localName === localName || attr.name === localName || attr.name.endsWith(`:${localName}`)) {
      return attr.value;
    }
  }
  return null;
}

function firstChildByTag(parent: Element, localName: string): Element | null {
  return Array.from(parent.childNodes).find(
    (node): node is Element => node.nodeType === Node.ELEMENT_NODE && (node as Element).localName === localName,
  ) ?? null;
}

function parseXml(xmlText: string, label: string): XMLDocument {
  const parser = new DOMParser();
  const xml = parser.parseFromString(xmlText, 'application/xml');
  if (xml.getElementsByTagName('parsererror').length > 0) {
    throw new Error(`${label} XML 解析失败`);
  }
  return xml;
}

function buildDocxStyleMap(stylesXmlText: string): Map<string, string> {
  const stylesXml = parseXml(stylesXmlText, 'DOCX styles');
  const map = new Map<string, string>();
  const styles = Array.from(stylesXml.getElementsByTagNameNS(WORD_NS, 'style'));
  for (const style of styles) {
    const styleId = getAttributeValue(style, 'styleId');
    const nameNode = firstChildByTag(style, 'name');
    const styleName = nameNode ? getAttributeValue(nameNode, 'val') : null;
    if (styleId && styleName) {
      map.set(styleId, styleName);
    }
  }
  return map;
}

function compactVerticalText(text: string): string {
  const lines = text.split('\n');
  const merged: string[] = [];
  let singleCharBuffer: string[] = [];

  const flushSingleChars = () => {
    if (singleCharBuffer.length >= 3) {
      merged.push(singleCharBuffer.join(''));
    } else if (singleCharBuffer.length > 0) {
      merged.push(...singleCharBuffer);
    }
    singleCharBuffer = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (/^[\p{Script=Han}A-Za-z0-9（）()《》\-—]$/u.test(line)) {
      singleCharBuffer.push(line);
      continue;
    }
    flushSingleChars();
    if (line) merged.push(line);
  }
  flushSingleChars();

  return merged.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function normalizeDocxText(text: string): string {
  return compactVerticalText(
    text
      .replace(/\u00A0/g, ' ')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim(),
  );
}

function extractParagraphSegments(paragraph: Element): string[] {
  const segments: string[] = [];
  let current = '';

  const pushSegment = () => {
    const normalized = normalizeDocxText(current);
    segments.push(normalized);
    current = '';
  };

  const walk = (node: Node) => {
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const element = node as Element;
    if (element.namespaceURI === WORD_NS) {
      if (element.localName === 't') {
        current += element.textContent ?? '';
        return;
      }
      if (element.localName === 'tab') {
        current += '\t';
        return;
      }
      if (element.localName === 'cr') {
        current += '\n';
        return;
      }
      if (element.localName === 'lastRenderedPageBreak') {
        pushSegment();
        return;
      }
      if (element.localName === 'br') {
        const breakType = getAttributeValue(element, 'type');
        if (breakType === 'page') {
          pushSegment();
        } else {
          current += '\n';
        }
        return;
      }
    }

    for (const child of Array.from(element.childNodes)) {
      walk(child);
    }
  };

  walk(paragraph);
  pushSegment();
  return segments.filter(Boolean);
}

function getParagraphStyleName(paragraph: Element, styleMap: Map<string, string>): string {
  const paragraphProperties = firstChildByTag(paragraph, 'pPr');
  const styleNode = paragraphProperties ? firstChildByTag(paragraphProperties, 'pStyle') : null;
  const styleId = styleNode ? getAttributeValue(styleNode, 'val') : null;
  if (!styleId) return '';
  return styleMap.get(styleId) ?? styleId;
}

function hasParagraphPageBreakBefore(paragraph: Element): boolean {
  const paragraphProperties = firstChildByTag(paragraph, 'pPr');
  if (!paragraphProperties) return false;
  return firstChildByTag(paragraphProperties, 'pageBreakBefore') !== null;
}

function isDocxHeading(styleName: string): { isHeading: boolean; level: number } {
  if (!styleName) return { isHeading: false, level: 1 };
  if (styleName === 'Title') return { isHeading: true, level: 1 };
  const match = /^Heading\s*(\d+)?$/i.exec(styleName);
  if (!match) return { isHeading: false, level: 1 };
  return { isHeading: true, level: Number(match[1] ?? '1') || 1 };
}

function buildDocxSections(paragraphs: Array<{ text: string; styleName: string }>): DocumentSection[] {
  const sections: DocumentSection[] = [];
  let currentSection: DocumentSection | null = null;

  for (const paragraph of paragraphs) {
    const text = paragraph.text.trim();
    if (!text) continue;
    const heading = isDocxHeading(paragraph.styleName);

    if (heading.isHeading) {
      if (currentSection) {
        currentSection.content = currentSection.content.trim();
        sections.push(currentSection);
      }
      currentSection = {
        title: text,
        level: heading.level,
        content: '',
      };
      continue;
    }

    if (!currentSection) {
      currentSection = {
        title: 'Untitled Section',
        level: 1,
        content: '',
      };
    }
    currentSection.content += `${text}\n`;
  }

  if (currentSection) {
    currentSection.content = currentSection.content.trim();
    sections.push(currentSection);
  }

  return sections.filter((section) => section.title || section.content);
}

function buildDocxPageTexts(paragraphs: Array<{ segments: string[]; pageBreakBefore: boolean }>): string[] {
  const explicitPages: string[] = [];
  let currentPageParagraphs: string[] = [];
  let sawExplicitBreak = false;

  const flushPage = () => {
    const pageText = normalizeDocxText(currentPageParagraphs.join('\n\n'));
    if (pageText) explicitPages.push(pageText);
    currentPageParagraphs = [];
  };

  for (const paragraph of paragraphs) {
    if (paragraph.pageBreakBefore) {
      sawExplicitBreak = true;
      flushPage();
    }
    if (paragraph.segments.length === 0) continue;
    if (paragraph.segments.length > 1) sawExplicitBreak = true;

    paragraph.segments.forEach((segment, index) => {
      if (index > 0) flushPage();
      if (segment) currentPageParagraphs.push(segment);
    });
  }
  flushPage();

  if (sawExplicitBreak && explicitPages.length > 1) {
    return explicitPages;
  }

  const flattenedParagraphs = paragraphs.flatMap((paragraph) => paragraph.segments).map((segment) => normalizeDocxText(segment)).filter(Boolean);
  if (flattenedParagraphs.length === 0) return [];

  const estimatedPages: string[] = [];
  let currentPage = '';
  let paragraphCount = 0;
  const targetChars = 1800;
  const maxParagraphs = 12;

  for (const paragraph of flattenedParagraphs) {
    const candidate = currentPage ? `${currentPage}\n\n${paragraph}` : paragraph;
    const shouldSplit = currentPage.length > 0 && (
      (candidate.length > targetChars && paragraphCount >= 4) ||
      paragraphCount >= maxParagraphs
    );

    if (shouldSplit) {
      estimatedPages.push(currentPage);
      currentPage = paragraph;
      paragraphCount = 1;
      continue;
    }

    currentPage = candidate;
    paragraphCount += 1;
  }

  if (currentPage) estimatedPages.push(currentPage);
  return estimatedPages.map((page) => normalizeDocxText(page)).filter(Boolean);
}

async function parseDocxFile(file: File): Promise<{ parsedText: string; sections: DocumentSection[]; pageTexts: string[] }> {
  try {
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    const documentXmlText = await zip.file('word/document.xml')?.async('string');
    if (!documentXmlText) throw new Error('DOCX 缺少 word/document.xml');

    const stylesFile = zip.file('word/styles.xml');
    const stylesXmlText = stylesFile ? await stylesFile.async('string') : '';
    const styleMap = stylesXmlText ? buildDocxStyleMap(stylesXmlText) : new Map<string, string>();
    const documentXml = parseXml(documentXmlText, 'DOCX document');
    const paragraphNodes = Array.from(documentXml.getElementsByTagNameNS(WORD_NS, 'p'));

    const paragraphs = paragraphNodes.map((paragraph) => {
      const segments = extractParagraphSegments(paragraph);
      return {
        styleName: getParagraphStyleName(paragraph, styleMap),
        pageBreakBefore: hasParagraphPageBreakBefore(paragraph),
        segments,
        text: normalizeDocxText(segments.join('\n')),
      };
    }).filter((paragraph) => paragraph.text || paragraph.segments.length > 0);

    const pageTexts = buildDocxPageTexts(paragraphs);
    const parsedText = normalizeDocxText(pageTexts.join('\n\n')) || normalizeDocxText(paragraphs.map((paragraph) => paragraph.text).join('\n\n'));
    const sections = buildDocxSections(paragraphs);

    return {
      parsedText,
      sections: sections.length > 0 ? sections : splitTextIntoSections(parsedText),
      pageTexts: pageTexts.length > 0 ? pageTexts : [parsedText],
    };
  } catch (error) {
    console.error('Failed to parse DOCX document', error);
    const message = error instanceof Error ? error.message : '未知错误';
    throw new Error(`DOCX 解析失败：${message}`);
  }
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

  async uploadDocuments(projectId: string, files: File[], options?: {
    onProgress?: (progress: DocumentUploadProgress) => void;
  }): Promise<DocumentRecord[]> {
    const emitProgress = (progress: DocumentUploadProgress) => {
      options?.onProgress?.(progress);
    };

    const documents: DocumentRecord[] = [];
    for (const [index, file] of files.entries()) {
      const current = index + 1;
      emitProgress({
        phase: 'reading',
        current,
        total: files.length,
        fileName: file.name,
        message: `正在读取文件 ${current}/${files.length}: ${file.name}`,
      });

      const extension = file.name.split('.').pop()?.toLowerCase();
      if (!extension || !['pdf', 'docx', 'txt'].includes(extension)) throw new Error(`不支持的文件类型：${file.name}`);
      const timestamp = isoNow();
      const id = crypto.randomUUID();
      const fileType = extension as 'pdf' | 'docx' | 'txt';
      let parsedText = '';
      let sections: DocumentSection[] = [];
      let parseStatus: DocumentRecord['parseStatus'] = 'completed';
      let parseError: string | undefined;
      let pageTexts: string[] | undefined;
      let pageCount: number | undefined;

      emitProgress({
        phase: 'parsing',
        current,
        total: files.length,
        fileName: file.name,
        message: fileType === 'pdf'
          ? `正在解析 PDF ${current}/${files.length}: ${file.name}`
          : fileType === 'docx'
            ? `正在解析 DOCX ${current}/${files.length}: ${file.name}`
            : `正在读取文本 ${current}/${files.length}: ${file.name}`,
      });

      if (fileType === 'txt') {
        parsedText = await file.text();
        sections = splitTextIntoSections(parsedText);
        pageTexts = parsedText ? [parsedText] : undefined;
        pageCount = pageTexts?.length;
      } else if (fileType === 'pdf') {
        const result = await parsePdfFile(file);
        parsedText = result.parsedText;
        sections = result.sections;
        pageTexts = result.pageTexts;
        pageCount = pageTexts.length;
      } else if (fileType === 'docx') {
        const result = await parseDocxFile(file);
        parsedText = result.parsedText;
        sections = result.sections;
        pageTexts = result.pageTexts;
        pageCount = result.pageTexts.length;
      } else {
        parseStatus = 'failed';
        parseError = `不支持的文件类型：${fileType}`;
      }
      if (sections.length === 0) {
        parseStatus = 'failed';
        parseError = parseError ?? `未能从 ${file.name} 中提取可用内容`;
      }

      documents.push({
        id,
        projectId,
        filename: file.name,
        fileType,
          filePath: `documents/${projectId}/${id}.${extension}`,
          fileSizeBytes: file.size,
          pageCount,
          wordCount: wordCount(parsedText),
          parsedText: parsedText || undefined,
          sections,
        pageTexts,
        ocrApplied: false,
        parseStatus,
        parseError,
        createdAt: timestamp,
        updatedAt: timestamp,
      } satisfies DocumentRecord);
    }

    emitProgress({
      phase: 'saving',
      current: files.length,
      total: files.length,
      message: '解析完成，正在写入本地项目索引...',
    });

    await mutateSnapshot((snapshot) => {
      snapshot.documents.push(...documents);
    });
    await projectService.touchProject(projectId);

    emitProgress({
      phase: 'completed',
      current: files.length,
      total: files.length,
      message: `已导入 ${documents.length} 个文档`,
    });

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
