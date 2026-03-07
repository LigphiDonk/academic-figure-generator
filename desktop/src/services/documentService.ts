import type { DocumentRecord, DocumentSection } from '../types/models';
import { isoNow, wordCount } from '../lib/utils';
import { mutateSnapshot, readSnapshot } from './storage';
import { projectService } from './projectService';

type PdfJsModule = {
  getDocument: (input: { data: Uint8Array; disableWorker?: boolean }) => {
    promise: Promise<{
      numPages: number;
      getPage: (pageNumber: number) => Promise<{
        getTextContent: () => Promise<{ items: Array<{ str?: string }> }>;
      }>;
    }>;
  };
};

type MammothModule = {
  extractRawText: (input: { arrayBuffer: ArrayBuffer }) => Promise<{ value: string }>;
};

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
  const pdfjs = (await import('pdfjs-dist/legacy/build/pdf.mjs')) as unknown as PdfJsModule;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjs.getDocument({ data: bytes, disableWorker: true }).promise;
  const pages = await Promise.all(
    Array.from({ length: pdf.numPages }, async (_, index) => {
      const page = await pdf.getPage(index + 1);
      const content = await page.getTextContent();
      return content.items.map((item) => item.str ?? '').join(' ').trim();
    }),
  );
  const parsedText = pages.filter(Boolean).join('\n\n');
  return { parsedText, sections: splitTextIntoSections(parsedText) };
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
