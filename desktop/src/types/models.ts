export type ProjectStatus = 'active' | 'archived' | 'deleted';
export type ParseStatus = 'pending' | 'processing' | 'completed' | 'failed';
export type GenerationStatus = 'pending' | 'processing' | 'completed' | 'failed';
export type Resolution = '1K' | '2K' | '4K';
export type AspectRatio = '1:1' | '4:3' | '3:4' | '16:9' | '9:16' | '3:2' | '2:3';
export type ApiName = 'claude' | 'nanobanana' | 'ocr';

export type FigureType =
  | 'overall_framework'
  | 'network_architecture'
  | 'module_detail'
  | 'comparison_ablation'
  | 'data_behavior';

export interface ColorValues {
  primary: string;
  secondary: string;
  tertiary: string;
  text: string;
  fill: string;
  sectionBg: string;
  border: string;
  arrow: string;
}

export interface ColorScheme {
  id: string;
  name: string;
  description: string;
  colors: ColorValues;
  isDefault: boolean;
  isPreset: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Project {
  id: string;
  name: string;
  description?: string;
  paperField?: string;
  colorScheme: string;
  customColors?: ColorValues;
  status: ProjectStatus;
  createdAt: string;
  updatedAt: string;
  documentCount: number;
  promptCount: number;
  imageCount: number;
}

export interface DocumentSection {
  title: string;
  content: string;
  level: number;
}

export interface DocumentRecord {
  id: string;
  projectId: string;
  filename: string;
  fileType: 'pdf' | 'docx' | 'txt';
  filePath: string;
  fileSizeBytes: number;
  pageCount?: number;
  wordCount?: number;
  parsedText?: string;
  sections: DocumentSection[];
  ocrApplied: boolean;
  parseStatus: ParseStatus;
  parseError?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PromptSourceSections {
  titles: string[];
  rationale: string;
}

export interface PromptRecord {
  id: string;
  projectId: string;
  documentId?: string;
  figureNumber: number;
  title?: string;
  originalPrompt?: string;
  editedPrompt?: string;
  suggestedFigureType?: FigureType;
  suggestedAspectRatio?: AspectRatio;
  sourceSections?: PromptSourceSections;
  claudeModel?: string;
  generationStatus: GenerationStatus;
  generationError?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ImageRecord {
  id: string;
  projectId?: string;
  promptId?: string;
  resolution: Resolution;
  aspectRatio: AspectRatio;
  colorScheme?: string;
  customColors?: ColorValues;
  referenceImagePath?: string;
  editInstruction?: string;
  filePath?: string;
  previewDataUrl?: string;
  fileSizeBytes?: number;
  widthPx?: number;
  heightPx?: number;
  finalPromptSent?: string;
  generationStatus: GenerationStatus;
  generationDurationMs?: number;
  generationError?: string;
  retryCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ApiUsageLog {
  id: string;
  projectId?: string;
  apiName: ApiName;
  apiEndpoint?: string;
  inputTokens?: number;
  outputTokens?: number;
  claudeModel?: string;
  resolution?: Resolution;
  aspectRatio?: AspectRatio;
  requestDurationMs?: number;
  isSuccess: boolean;
  errorMessage?: string;
  billingPeriod: string;
  createdAt: string;
}

export interface PublicSettings {
  defaultColorScheme: string;
  defaultResolution: Resolution;
  defaultAspectRatio: AspectRatio;
  setupCompleted: boolean;
  appVersion: string;
  language: 'zh-CN';
  theme: 'system' | 'light' | 'dark';
}

export interface SecureSettings {
  claudeApiKey: string;
  claudeBaseUrl: string;
  claudeModel: string;
  nanobananaApiKey: string;
  nanobananaBaseUrl: string;
  ocrServerUrl: string;
  ocrToken: string;
}

export interface AppPaths {
  mode: 'tauri' | 'browser';
  appDataDir: string;
  documentsDir: string;
  imagesDir: string;
}

export interface AppSnapshot {
  version: number;
  projects: Project[];
  documents: DocumentRecord[];
  prompts: PromptRecord[];
  images: ImageRecord[];
  colorSchemes: ColorScheme[];
  usageLogs: ApiUsageLog[];
  settings: PublicSettings;
}
