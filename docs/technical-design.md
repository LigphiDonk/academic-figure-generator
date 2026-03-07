# 技术设计文档
# Academic Figure Generator Desktop — 学术论文配图生成器桌面版

**版本**: v1.0
**日期**: 2026-03-06
**状态**: 草稿

---

## 目录

1. [技术栈概览](#1-技术栈概览)
2. [整体架构](#2-整体架构)
3. [目录结构](#3-目录结构)
4. [SQLite 数据库 Schema](#4-sqlite-数据库-schema)
5. [TypeScript 服务层接口](#5-typescript-服务层接口)
6. [Tauri Commands 设计](#6-tauri-commands-设计)
7. [前端架构 (React)](#7-前端架构-react)
8. [Python → TypeScript 移植指南](#8-python--typescript-移植指南)
9. [API 客户端设计](#9-api-客户端设计)
10. [加密存储方案](#10-加密存储方案)
11. [文档解析方案](#11-文档解析方案)
12. [构建与发布流程](#12-构建与发布流程)
13. [开发环境搭建](#13-开发环境搭建)

---

## 1. 技术栈概览

| 层次 | 技术 | 说明 |
|------|------|------|
| 桌面框架 | Tauri 2.0 | Rust 核心，WebView 前端 |
| 前端框架 | React 18 + TypeScript | 复用 Web 版代码 |
| 路由 | React Router v6 | SPA 路由 |
| 状态管理 | Zustand | 轻量全局状态 |
| UI 组件 | shadcn/ui + Tailwind CSS | 复用 Web 版 |
| 数据库 | SQLite (via `tauri-plugin-sql`) | 本地持久化 |
| 加密存储 | `tauri-plugin-stronghold` | API Key 安全存储 |
| 文档解析 | pdf.js + mammoth.js | 客户端 PDF/DOCX 解析 |
| HTTP 客户端 | `@tauri-apps/plugin-http` | 绕过 CORS 限制 |
| 包管理 | pnpm | 前端依赖管理 |
| Rust 工具链 | rustup + cargo | Tauri 原生层 |
| 构建工具 | Vite | 前端打包 |
| 类型检查 | TypeScript strict mode | 类型安全 |

---

## 2. 整体架构

```
┌──────────────────────────────────────────────────────────────┐
│                    Tauri Desktop App                          │
│                                                              │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │                  React Frontend (WebView)                │ │
│  │                                                         │ │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────────────────┐  │ │
│  │  │  Pages   │  │  Hooks   │  │   Services (TS)       │  │ │
│  │  │/projects │  │useProject│  │  ProjectService       │  │ │
│  │  │/generate │  │usePrompts│  │  PromptService        │  │ │
│  │  │/settings │  │useImages │  │  ImageService         │  │ │
│  │  │/usage    │  │          │  │  DocumentService      │  │ │
│  │  └──────────┘  └──────────┘  │  UsageService         │  │ │
│  │                              │  SettingsService      │  │ │
│  │  ┌─────────────────────────┐ └──────────────────────┘  │ │
│  │  │   Zustand Store         │                            │ │
│  │  │  (global UI state)      │                            │ │
│  │  └─────────────────────────┘                            │ │
│  └──────────────────────────┬────────────────────────────┘  │
│                             │  invoke() / IPC                │
│  ┌──────────────────────────▼────────────────────────────┐  │
│  │                   Tauri Core (Rust)                    │  │
│  │                                                        │  │
│  │  ┌────────────────┐  ┌──────────────────────────────┐  │  │
│  │  │ tauri-plugin   │  │  tauri-plugin-stronghold      │  │  │
│  │  │ -sql (SQLite)  │  │  (encrypted API Key store)   │  │  │
│  │  └────────────────┘  └──────────────────────────────┘  │  │
│  │                                                        │  │
│  │  ┌────────────────┐  ┌──────────────────────────────┐  │  │
│  │  │ tauri-plugin   │  │  tauri-plugin-fs              │  │  │
│  │  │ -http          │  │  (文件系统访问)               │  │  │
│  │  └────────────────┘  └──────────────────────────────┘  │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐    │
│  │              本地存储 (App Data Directory)            │    │
│  │  database.sqlite  |  documents/  |  images/          │    │
│  └──────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
       Claude API      NanoBanana API    PaddleOCR
      (Anthropic)      (图片生成)       (可选 OCR)
```

### 核心设计原则

1. **无服务器**：所有业务逻辑在客户端执行，Rust 层只做系统级操作（文件 IO、加密存储、HTTP）
2. **服务层封装**：TypeScript 服务层对标原 Python FastAPI 服务，保持接口语义一致
3. **单向数据流**：React → Zustand Store → TypeScript Services → Tauri IPC → Rust
4. **渐进增强**：核心功能（项目管理、提示词编辑）完全离线，网络功能（API 调用）可选

---

## 3. 目录结构

```
academic-figure-generator-desktop/
├── src-tauri/                    # Tauri/Rust 核心
│   ├── src/
│   │   ├── main.rs               # Tauri 入口
│   │   ├── lib.rs                # 插件注册、command 声明
│   │   └── commands/             # Rust commands (可选，复杂操作)
│   │       └── ocr.rs            # OCR 代理请求
│   ├── Cargo.toml
│   ├── tauri.conf.json           # Tauri 配置
│   └── capabilities/
│       └── default.json          # 权限配置
│
├── src/                          # React 前端
│   ├── main.tsx                  # React 入口
│   ├── App.tsx                   # 路由配置
│   │
│   ├── pages/                    # 页面组件
│   │   ├── ProjectList/
│   │   ├── ProjectWorkspace/
│   │   │   ├── DocumentTab/
│   │   │   ├── PromptTab/
│   │   │   └── ImageTab/
│   │   ├── DirectGenerate/
│   │   ├── ColorSchemes/
│   │   ├── UsageStats/
│   │   ├── Settings/
│   │   └── Setup/                # 首次设置向导
│   │
│   ├── components/               # 共享 UI 组件
│   │   ├── ui/                   # shadcn/ui 组件
│   │   ├── ColorSchemePicker/
│   │   ├── ImageViewer/
│   │   ├── PromptEditor/
│   │   └── DocumentUploader/
│   │
│   ├── services/                 # TypeScript 业务服务层
│   │   ├── db.ts                 # SQLite 连接和迁移
│   │   ├── projectService.ts
│   │   ├── documentService.ts
│   │   ├── promptService.ts
│   │   ├── imageService.ts
│   │   ├── colorSchemeService.ts
│   │   ├── usageService.ts
│   │   └── settingsService.ts
│   │
│   ├── api/                      # 外部 API 客户端
│   │   ├── claudeClient.ts       # Claude API 调用
│   │   ├── nanobananaClient.ts   # NanoBanana API 调用
│   │   └── ocrClient.ts          # PaddleOCR 调用
│   │
│   ├── store/                    # Zustand 全局状态
│   │   ├── settingsStore.ts      # API Key、默认参数
│   │   ├── projectStore.ts       # 当前项目状态
│   │   └── uiStore.ts            # UI 状态（loading、modal等）
│   │
│   ├── hooks/                    # React Hooks
│   │   ├── useProjects.ts
│   │   ├── usePrompts.ts
│   │   ├── useImages.ts
│   │   └── useUsage.ts
│   │
│   ├── types/                    # TypeScript 类型定义
│   │   ├── models.ts             # 数据模型类型
│   │   ├── api.ts                # API 请求/响应类型
│   │   └── store.ts              # Store 类型
│   │
│   ├── lib/                      # 工具函数
│   │   ├── documentParser.ts     # pdf.js + mammoth.js 封装
│   │   ├── encryption.ts         # stronghold 封装
│   │   ├── fileSystem.ts         # Tauri fs 封装
│   │   └── utils.ts
│   │
│   └── styles/
│       └── globals.css
│
├── docs/
│   ├── requirements.md
│   └── technical-design.md      # 本文档
│
├── package.json
├── pnpm-lock.yaml
├── vite.config.ts
├── tsconfig.json
├── tailwind.config.ts
├── .gitignore
└── README.md
```

---

## 4. SQLite 数据库 Schema

数据库文件位于：
- macOS: `~/Library/Application Support/com.academic-figure-generator.desktop/database.sqlite`
- Windows: `%APPDATA%\com.academic-figure-generator.desktop\database.sqlite`

### 4.1 初始化与迁移

使用 `tauri-plugin-sql` 的 migrations 机制，迁移文件内嵌在 Rust 源码中。

```rust
// src-tauri/src/lib.rs
use tauri_plugin_sql::{Migration, MigrationKind};

let migrations = vec![
    Migration {
        version: 1,
        description: "initial_schema",
        sql: include_str!("../migrations/0001_initial.sql"),
        kind: MigrationKind::Up,
    },
];
```

### 4.2 建表 DDL

```sql
-- migrations/0001_initial.sql

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- 项目表
CREATE TABLE IF NOT EXISTS projects (
    id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    name        TEXT NOT NULL,
    description TEXT,
    paper_field TEXT,
    color_scheme TEXT NOT NULL DEFAULT 'okabe-ito',
    custom_colors TEXT,              -- JSON object
    status      TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'archived', 'deleted')),
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS ix_projects_updated_at ON projects(updated_at DESC);

-- 文档表
CREATE TABLE IF NOT EXISTS documents (
    id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    filename        TEXT NOT NULL,
    file_type       TEXT NOT NULL CHECK(file_type IN ('pdf', 'docx', 'txt')),
    file_path       TEXT NOT NULL,         -- 相对于 app data dir 的路径
    file_size_bytes INTEGER,
    parsed_text     TEXT,                  -- 全文解析结果
    sections        TEXT,                  -- JSON: [{title, content, level}]
    ocr_applied     INTEGER NOT NULL DEFAULT 0,  -- BOOLEAN
    parse_status    TEXT NOT NULL DEFAULT 'pending'
                        CHECK(parse_status IN ('pending', 'processing', 'completed', 'failed')),
    parse_error     TEXT,
    created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS ix_documents_project_id ON documents(project_id);

-- 提示词表
CREATE TABLE IF NOT EXISTS prompts (
    id                    TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    project_id            TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    document_id           TEXT REFERENCES documents(id) ON DELETE SET NULL,
    figure_number         INTEGER NOT NULL DEFAULT 1,
    title                 TEXT,
    original_prompt       TEXT,
    edited_prompt         TEXT,            -- 用户手动编辑后的版本
    suggested_figure_type TEXT,            -- overall_framework / network_architecture / ...
    suggested_aspect_ratio TEXT,
    source_sections       TEXT,            -- JSON: {titles: [], rationale: ""}
    claude_model          TEXT,
    generation_status     TEXT NOT NULL DEFAULT 'completed'
                              CHECK(generation_status IN ('pending', 'processing', 'completed', 'failed')),
    generation_error      TEXT,
    created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS ix_prompts_project_id ON prompts(project_id);

-- 图片表
CREATE TABLE IF NOT EXISTS images (
    id                    TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    project_id            TEXT REFERENCES projects(id) ON DELETE CASCADE,
    prompt_id             TEXT REFERENCES prompts(id) ON DELETE SET NULL,
    resolution            TEXT NOT NULL DEFAULT '2K' CHECK(resolution IN ('1K', '2K', '4K')),
    aspect_ratio          TEXT NOT NULL DEFAULT '4:3',
    color_scheme          TEXT,
    custom_colors         TEXT,            -- JSON object
    reference_image_path  TEXT,           -- 图生图时的参考图路径
    edit_instruction      TEXT,           -- 图生图编辑指令
    file_path             TEXT,           -- 相对于 app data dir 的路径
    file_size_bytes       INTEGER,
    width_px              INTEGER,
    height_px             INTEGER,
    final_prompt_sent     TEXT,           -- 实际发送给 API 的 prompt
    generation_status     TEXT NOT NULL DEFAULT 'pending'
                              CHECK(generation_status IN ('pending', 'processing', 'completed', 'failed')),
    generation_duration_ms INTEGER,
    generation_error      TEXT,
    retry_count           INTEGER NOT NULL DEFAULT 0,
    created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS ix_images_project_id ON images(project_id);
CREATE INDEX IF NOT EXISTS ix_images_prompt_id  ON images(prompt_id);

-- 自定义配色方案表（预设通过代码内置，此表仅存用户自定义）
CREATE TABLE IF NOT EXISTS color_schemes (
    id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    name        TEXT NOT NULL UNIQUE,
    colors      TEXT NOT NULL,             -- JSON: {primary, secondary, accent, background, text, border, success, warning}
    is_default  INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- API 使用日志表
CREATE TABLE IF NOT EXISTS api_usage_logs (
    id                   TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    project_id           TEXT REFERENCES projects(id) ON DELETE SET NULL,
    api_name             TEXT NOT NULL CHECK(api_name IN ('claude', 'nanobanana', 'ocr')),
    api_endpoint         TEXT,
    input_tokens         INTEGER,
    output_tokens        INTEGER,
    claude_model         TEXT,
    resolution           TEXT,
    aspect_ratio         TEXT,
    request_duration_ms  INTEGER,
    is_success           INTEGER NOT NULL DEFAULT 1,
    error_message        TEXT,
    billing_period       TEXT NOT NULL,    -- YYYY-MM
    created_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS ix_usage_logs_billing_period ON api_usage_logs(billing_period);
CREATE INDEX IF NOT EXISTS ix_usage_logs_api_name       ON api_usage_logs(api_name);

-- 应用设置表（非敏感，明文存储）
CREATE TABLE IF NOT EXISTS settings (
    key         TEXT PRIMARY KEY,
    value       TEXT NOT NULL,
    updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- 预置默认设置
INSERT OR IGNORE INTO settings(key, value) VALUES
    ('default_color_scheme', 'okabe-ito'),
    ('default_resolution', '2K'),
    ('default_aspect_ratio', '4:3'),
    ('setup_completed', 'false'),
    ('app_version', '1.0.0');
```

---

## 5. TypeScript 服务层接口

### 5.1 类型定义 (`src/types/models.ts`)

```typescript
// 与 SQLite schema 一一对应的 TypeScript 类型

export interface Project {
  id: string;
  name: string;
  description?: string;
  paperField?: string;
  colorScheme: string;
  customColors?: ColorValues;
  status: 'active' | 'archived' | 'deleted';
  createdAt: string;
  updatedAt: string;
  // 计算属性（查询时 JOIN）
  documentCount?: number;
  promptCount?: number;
  imageCount?: number;
}

export interface Document {
  id: string;
  projectId: string;
  filename: string;
  fileType: 'pdf' | 'docx' | 'txt';
  filePath: string;
  fileSizeBytes?: number;
  parsedText?: string;
  sections?: DocumentSection[];
  ocrApplied: boolean;
  parseStatus: 'pending' | 'processing' | 'completed' | 'failed';
  parseError?: string;
  createdAt: string;
  updatedAt: string;
}

export interface DocumentSection {
  title: string;
  content: string;
  level: number;  // 标题层级 1-6
}

export interface Prompt {
  id: string;
  projectId: string;
  documentId?: string;
  figureNumber: number;
  title?: string;
  originalPrompt?: string;
  editedPrompt?: string;
  activePrompt: string;  // editedPrompt ?? originalPrompt
  suggestedFigureType?: FigureType;
  suggestedAspectRatio?: string;
  sourceSections?: { titles: string[]; rationale: string };
  claudeModel?: string;
  generationStatus: 'pending' | 'processing' | 'completed' | 'failed';
  generationError?: string;
  createdAt: string;
  updatedAt: string;
}

export type FigureType =
  | 'overall_framework'
  | 'network_architecture'
  | 'module_detail'
  | 'comparison_ablation'
  | 'data_behavior';

export interface Image {
  id: string;
  projectId?: string;
  promptId?: string;
  resolution: '1K' | '2K' | '4K';
  aspectRatio: string;
  colorScheme?: string;
  customColors?: ColorValues;
  referenceImagePath?: string;
  editInstruction?: string;
  filePath?: string;
  fileSizeBytes?: number;
  widthPx?: number;
  heightPx?: number;
  finalPromptSent?: string;
  generationStatus: 'pending' | 'processing' | 'completed' | 'failed';
  generationDurationMs?: number;
  generationError?: string;
  retryCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ColorScheme {
  id: string;
  name: string;
  colors: ColorValues;
  isDefault: boolean;
  isPreset: boolean;  // true = 内置预设，false = 用户自定义
  createdAt: string;
  updatedAt: string;
}

export interface ColorValues {
  primary: string;
  secondary: string;
  accent: string;
  background: string;
  text: string;
  border: string;
  success: string;
  warning: string;
}

export interface ApiUsageLog {
  id: string;
  projectId?: string;
  apiName: 'claude' | 'nanobanana' | 'ocr';
  apiEndpoint?: string;
  inputTokens?: number;
  outputTokens?: number;
  claudeModel?: string;
  resolution?: string;
  aspectRatio?: string;
  requestDurationMs?: number;
  isSuccess: boolean;
  errorMessage?: string;
  billingPeriod: string;  // YYYY-MM
  createdAt: string;
}
```

### 5.2 ProjectService (`src/services/projectService.ts`)

```typescript
import Database from '@tauri-apps/plugin-sql';
import { Project } from '../types/models';

export class ProjectService {
  constructor(private db: Database) {}

  async listProjects(): Promise<Project[]> {
    return this.db.select<Project[]>(`
      SELECT
        p.*,
        COUNT(DISTINCT d.id) AS document_count,
        COUNT(DISTINCT pr.id) AS prompt_count,
        COUNT(DISTINCT i.id) AS image_count
      FROM projects p
      LEFT JOIN documents d ON d.project_id = p.id
      LEFT JOIN prompts pr ON pr.project_id = p.id
      LEFT JOIN images i ON i.project_id = p.id
      WHERE p.status = 'active'
      GROUP BY p.id
      ORDER BY p.updated_at DESC
    `);
  }

  async getProject(id: string): Promise<Project | null> {
    const rows = await this.db.select<Project[]>(
      'SELECT * FROM projects WHERE id = $1 AND status != "deleted"',
      [id]
    );
    return rows[0] ?? null;
  }

  async createProject(data: {
    name: string;
    description?: string;
    paperField?: string;
    colorScheme: string;
    customColors?: object;
  }): Promise<Project> {
    const id = crypto.randomUUID();
    await this.db.execute(
      `INSERT INTO projects (id, name, description, paper_field, color_scheme, custom_colors)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        id,
        data.name,
        data.description ?? null,
        data.paperField ?? null,
        data.colorScheme,
        data.customColors ? JSON.stringify(data.customColors) : null,
      ]
    );
    return (await this.getProject(id))!;
  }

  async updateProject(id: string, data: Partial<Pick<Project, 'name' | 'description' | 'paperField' | 'colorScheme' | 'customColors'>>): Promise<Project> {
    const fields: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (data.name !== undefined)        { fields.push(`name = $${idx++}`);         values.push(data.name); }
    if (data.description !== undefined) { fields.push(`description = $${idx++}`);  values.push(data.description); }
    if (data.paperField !== undefined)  { fields.push(`paper_field = $${idx++}`);  values.push(data.paperField); }
    if (data.colorScheme !== undefined) { fields.push(`color_scheme = $${idx++}`); values.push(data.colorScheme); }
    if (data.customColors !== undefined){ fields.push(`custom_colors = $${idx++}`);values.push(JSON.stringify(data.customColors)); }

    fields.push(`updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`);
    values.push(id);

    await this.db.execute(
      `UPDATE projects SET ${fields.join(', ')} WHERE id = $${idx}`,
      values
    );
    return (await this.getProject(id))!;
  }

  async deleteProject(id: string): Promise<void> {
    await this.db.execute(
      `UPDATE projects SET status = 'deleted', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = $1`,
      [id]
    );
  }
}
```

### 5.3 PromptService (`src/services/promptService.ts`)

```typescript
import Database from '@tauri-apps/plugin-sql';
import { Prompt } from '../types/models';

export class PromptService {
  constructor(private db: Database) {}

  async getPromptsByProject(projectId: string): Promise<Prompt[]> {
    const rows = await this.db.select<Prompt[]>(
      `SELECT * FROM prompts WHERE project_id = $1 ORDER BY figure_number ASC`,
      [projectId]
    );
    return rows.map(this.hydrate);
  }

  async getPrompt(id: string): Promise<Prompt | null> {
    const rows = await this.db.select<Prompt[]>(
      'SELECT * FROM prompts WHERE id = $1',
      [id]
    );
    return rows[0] ? this.hydrate(rows[0]) : null;
  }

  async createPrompts(
    projectId: string,
    documentId: string | null,
    figures: Array<{
      figureNumber: number;
      title?: string;
      prompt: string;
      suggestedFigureType?: string;
      suggestedAspectRatio?: string;
      sourceSectionTitles?: string[];
      rationale?: string;
    }>,
    claudeModel?: string
  ): Promise<Prompt[]> {
    const created: Prompt[] = [];
    for (const fig of figures) {
      const id = crypto.randomUUID();
      await this.db.execute(
        `INSERT INTO prompts
         (id, project_id, document_id, figure_number, title, original_prompt,
          suggested_figure_type, suggested_aspect_ratio, source_sections, claude_model, generation_status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'completed')`,
        [
          id,
          projectId,
          documentId,
          fig.figureNumber,
          fig.title ?? null,
          fig.prompt,
          fig.suggestedFigureType ?? null,
          fig.suggestedAspectRatio ?? null,
          JSON.stringify({ titles: fig.sourceSectionTitles ?? [], rationale: fig.rationale ?? '' }),
          claudeModel ?? null,
        ]
      );
      created.push((await this.getPrompt(id))!);
    }
    return created;
  }

  async updateEditedPrompt(id: string, editedPrompt: string): Promise<Prompt> {
    await this.db.execute(
      `UPDATE prompts SET edited_prompt = $1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = $2`,
      [editedPrompt, id]
    );
    return (await this.getPrompt(id))!;
  }

  async deletePrompt(id: string): Promise<void> {
    await this.db.execute('DELETE FROM prompts WHERE id = $1', [id]);
  }

  private hydrate(row: Prompt): Prompt {
    return {
      ...row,
      sourceSections: typeof row.sourceSections === 'string'
        ? JSON.parse(row.sourceSections)
        : row.sourceSections,
      activePrompt: row.editedPrompt ?? row.originalPrompt ?? '',
    };
  }
}
```

### 5.4 SettingsService (`src/services/settingsService.ts`)

```typescript
import Database from '@tauri-apps/plugin-sql';

export type SettingKey =
  | 'default_color_scheme'
  | 'default_resolution'
  | 'default_aspect_ratio'
  | 'setup_completed'
  | 'app_version';

export class SettingsService {
  constructor(private db: Database) {}

  async get(key: SettingKey): Promise<string | null> {
    const rows = await this.db.select<{ value: string }[]>(
      'SELECT value FROM settings WHERE key = $1',
      [key]
    );
    return rows[0]?.value ?? null;
  }

  async set(key: SettingKey, value: string): Promise<void> {
    await this.db.execute(
      `INSERT INTO settings (key, value, updated_at)
       VALUES ($1, $2, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      [key, value]
    );
  }

  async isSetupCompleted(): Promise<boolean> {
    return (await this.get('setup_completed')) === 'true';
  }
}
```

### 5.5 UsageService (`src/services/usageService.ts`)

```typescript
import Database from '@tauri-apps/plugin-sql';
import { ApiUsageLog } from '../types/models';

export interface UsageSummary {
  billingPeriod: string;
  claudeInputTokens: number;
  claudeOutputTokens: number;
  claudeCalls: number;
  nanobananaTotal: number;
  nanobananaByResolution: Record<string, number>;
}

export class UsageService {
  constructor(private db: Database) {}

  async logClaudeCall(params: {
    projectId?: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    durationMs: number;
    isSuccess: boolean;
    errorMessage?: string;
  }): Promise<void> {
    const billingPeriod = new Date().toISOString().slice(0, 7); // YYYY-MM
    await this.db.execute(
      `INSERT INTO api_usage_logs
       (id, project_id, api_name, claude_model, input_tokens, output_tokens,
        request_duration_ms, is_success, error_message, billing_period)
       VALUES ($1,$2,'claude',$3,$4,$5,$6,$7,$8,$9)`,
      [
        crypto.randomUUID(),
        params.projectId ?? null,
        params.model,
        params.inputTokens,
        params.outputTokens,
        params.durationMs,
        params.isSuccess ? 1 : 0,
        params.errorMessage ?? null,
        billingPeriod,
      ]
    );
  }

  async logNanobananaCall(params: {
    projectId?: string;
    resolution: string;
    aspectRatio: string;
    durationMs: number;
    isSuccess: boolean;
    errorMessage?: string;
  }): Promise<void> {
    const billingPeriod = new Date().toISOString().slice(0, 7);
    await this.db.execute(
      `INSERT INTO api_usage_logs
       (id, project_id, api_name, resolution, aspect_ratio,
        request_duration_ms, is_success, error_message, billing_period)
       VALUES ($1,$2,'nanobanana',$3,$4,$5,$6,$7,$8)`,
      [
        crypto.randomUUID(),
        params.projectId ?? null,
        params.resolution,
        params.aspectRatio,
        params.durationMs,
        params.isSuccess ? 1 : 0,
        params.errorMessage ?? null,
        billingPeriod,
      ]
    );
  }

  async getSummaryByMonth(months = 6): Promise<UsageSummary[]> {
    return this.db.select<UsageSummary[]>(`
      SELECT
        billing_period,
        SUM(CASE WHEN api_name = 'claude' THEN input_tokens ELSE 0 END) AS claude_input_tokens,
        SUM(CASE WHEN api_name = 'claude' THEN output_tokens ELSE 0 END) AS claude_output_tokens,
        COUNT(CASE WHEN api_name = 'claude' THEN 1 END) AS claude_calls,
        COUNT(CASE WHEN api_name = 'nanobanana' THEN 1 END) AS nanobanana_total
      FROM api_usage_logs
      WHERE billing_period >= strftime('%Y-%m', 'now', '-${months} months')
      GROUP BY billing_period
      ORDER BY billing_period DESC
    `);
  }
}
```

---

## 6. Tauri Commands 设计

大多数业务逻辑在 TypeScript 层处理，Rust Commands 仅处理需要系统级权限的操作：

### 6.1 文件系统操作

通过 `tauri-plugin-fs` 直接在 TypeScript 层调用，无需自定义 Command：

```typescript
import { BaseDirectory, writeFile, readFile, removeFile } from '@tauri-apps/plugin-fs';

// 保存图片到 app data 目录
await writeFile(
  `images/${projectId}/${imageId}.png`,
  imageBytes,
  { baseDir: BaseDirectory.AppData }
);
```

### 6.2 自定义 Rust Commands（仅用于特殊场景）

```rust
// src-tauri/src/commands/ocr.rs

/// 代理 OCR 请求（处理可能的 SSL 证书问题或大文件上传）
#[tauri::command]
async fn proxy_ocr_request(
    url: String,
    token: Option<String>,
    image_base64: String,
) -> Result<String, String> {
    // 使用 reqwest 发起请求
    // 返回 OCR 结果 JSON 字符串
    todo!()
}
```

### 6.3 应用数据目录获取

```typescript
import { appDataDir } from '@tauri-apps/api/path';

const dataDir = await appDataDir();
// macOS: ~/Library/Application Support/com.academic-figure-generator.desktop/
// Windows: %APPDATA%\com.academic-figure-generator.desktop\
```

---

## 7. 前端架构 (React)

### 7.1 路由配置 (`src/App.tsx`)

```typescript
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useSetupCheck } from './hooks/useSetupCheck';

function App() {
  const { isSetupComplete, isLoading } = useSetupCheck();

  if (isLoading) return <SplashScreen />;
  if (!isSetupComplete) return <Navigate to="/setup" replace />;

  return (
    <BrowserRouter>
      <AppShell>
        <Routes>
          <Route path="/"              element={<Navigate to="/projects" replace />} />
          <Route path="/projects"      element={<ProjectListPage />} />
          <Route path="/projects/:id"  element={<ProjectWorkspacePage />} />
          <Route path="/generate"      element={<DirectGeneratePage />} />
          <Route path="/color-schemes" element={<ColorSchemesPage />} />
          <Route path="/usage"         element={<UsageStatsPage />} />
          <Route path="/settings"      element={<SettingsPage />} />
          <Route path="/setup"         element={<SetupPage />} />
        </Routes>
      </AppShell>
    </BrowserRouter>
  );
}
```

### 7.2 Zustand Store (`src/store/settingsStore.ts`)

```typescript
import { create } from 'zustand';
import { SecureStorage } from '../lib/encryption';

interface ApiConfig {
  claudeApiKey: string;
  claudeBaseUrl: string;
  claudeModel: string;
  nanobananaApiKey: string;
  nanobananaBaseUrl: string;
  ocrServerUrl?: string;
  ocrToken?: string;
}

interface SettingsStore {
  apiConfig: ApiConfig | null;
  defaultResolution: '1K' | '2K' | '4K';
  defaultAspectRatio: string;
  defaultColorScheme: string;
  loadApiConfig: () => Promise<void>;
  saveApiConfig: (config: ApiConfig) => Promise<void>;
}

export const useSettingsStore = create<SettingsStore>((set) => ({
  apiConfig: null,
  defaultResolution: '2K',
  defaultAspectRatio: '4:3',
  defaultColorScheme: 'okabe-ito',

  loadApiConfig: async () => {
    const storage = SecureStorage.getInstance();
    const config = await storage.getApiConfig();
    set({ apiConfig: config });
  },

  saveApiConfig: async (config: ApiConfig) => {
    const storage = SecureStorage.getInstance();
    await storage.saveApiConfig(config);
    set({ apiConfig: config });
  },
}));
```

### 7.3 数据库初始化 (`src/services/db.ts`)

```typescript
import Database from '@tauri-apps/plugin-sql';

let _db: Database | null = null;

export async function getDb(): Promise<Database> {
  if (_db) return _db;
  _db = await Database.load('sqlite:database.sqlite');
  return _db;
}

// 服务单例工厂
export async function getProjectService() {
  const { ProjectService } = await import('./projectService');
  return new ProjectService(await getDb());
}

export async function getPromptService() {
  const { PromptService } = await import('./promptService');
  return new PromptService(await getDb());
}
// ... 其他服务
```

---

## 8. Python → TypeScript 移植指南

Web 版使用 FastAPI + Python 后端。桌面版将后端逻辑迁移至 TypeScript，下表列出对应关系：

### 8.1 模块对照表

| Python (FastAPI) | TypeScript (Desktop) | 说明 |
|------------------|---------------------|------|
| `app/models/*.py` (SQLAlchemy) | `src/types/models.ts` | 数据模型定义 |
| `app/schemas/*.py` (Pydantic) | `src/types/api.ts` | 请求/响应类型 |
| `app/services/project_service.py` | `src/services/projectService.ts` | 项目 CRUD |
| `app/services/prompt_service.py` | `src/services/promptService.ts` | 提示词 CRUD |
| `app/services/document_service.py` | `src/services/documentService.ts` | 文档解析 |
| `app/services/usage_service.py` | `src/services/usageService.ts` | 用量统计 |
| `app/core/claude_client.py` | `src/api/claudeClient.ts` | Claude API 调用 |
| `app/core/nanobanana_client.py` | `src/api/nanobananaClient.ts` | 图片生成 API |
| PostgreSQL + Alembic | SQLite + tauri-plugin-sql | 数据库层 |
| Redis + Celery | 直接 async/await | 异步任务 |
| FastAPI 路由 | React Router + Hooks | 路由层 |
| JWT 认证 | 无（单用户本地应用） | 去除认证逻辑 |

### 8.2 关键差异

#### 1. 异步模型

```python
# Python: asyncio + Celery 任务队列
async def generate_prompts(project_id: UUID, ...):
    task = celery_app.send_task('generate_prompts', ...)
    return {"task_id": task.id}  # 轮询状态
```

```typescript
// TypeScript: 直接 async/await，React state 管理 loading
async function generatePrompts(projectId: string, ...) {
  setGenerating(true);
  try {
    const result = await claudeClient.generatePrompts(...);
    await promptService.createPrompts(projectId, result.figures);
    setPrompts(await promptService.getPromptsByProject(projectId));
  } finally {
    setGenerating(false);
  }
}
```

#### 2. 文件存储

```python
# Python: S3 / 本地服务器路径
storage_path = f"s3://bucket/users/{user_id}/images/{image_id}.png"
```

```typescript
// TypeScript: 相对于 app data dir 的路径
const filePath = `images/${projectId}/${imageId}.png`;
await writeFile(filePath, imageBytes, { baseDir: BaseDirectory.AppData });
```

#### 3. UUID 生成

```python
# Python
import uuid
id = str(uuid.uuid4())
```

```typescript
// TypeScript (Web Crypto API)
const id = crypto.randomUUID();
```

#### 4. JSON 字段处理

SQLite 不支持 JSONB，JSON 以 TEXT 存储，读写时手动序列化：

```typescript
// 写入
JSON.stringify({ titles: ['Section 1'], rationale: '...' })

// 读出（hydrate 方法中）
JSON.parse(row.sourceSections as string)
```

#### 5. 去除认证逻辑

Web 版所有接口有 `user_id` 过滤。桌面版为单用户本地应用，**完全去除 user_id**，所有查询直接操作全量数据。

---

## 9. API 客户端设计

使用 `@tauri-apps/plugin-http` 绕过浏览器 CORS 限制（WebView 内直接 fetch 跨域会被阻止）。

### 9.1 Claude API 客户端 (`src/api/claudeClient.ts`)

```typescript
import { fetch } from '@tauri-apps/plugin-http';

export interface GeneratePromptsParams {
  documentText: string;
  selectedSections: string[];
  figureTypes: string[];
  colorScheme: string;
  userRequest?: string;
  maxFigures: number;
  templateMode: boolean;
}

export interface GeneratedFigure {
  figureNumber: number;
  title: string;
  prompt: string;
  suggestedFigureType: string;
  suggestedAspectRatio: string;
  sourceSectionTitles: string[];
  rationale: string;
}

export class ClaudeClient {
  constructor(
    private apiKey: string,
    private baseUrl: string = 'https://api.anthropic.com',
    private model: string = 'claude-opus-4-5'
  ) {}

  async generatePrompts(params: GeneratePromptsParams): Promise<{
    figures: GeneratedFigure[];
    inputTokens: number;
    outputTokens: number;
  }> {
    const systemPrompt = this.buildSystemPrompt();
    const userMessage = this.buildUserMessage(params);

    const startTime = Date.now();
    const response = await fetch(`${this.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 4096,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
      }),
    });

    if (!response.ok) {
      throw new Error(`Claude API error: ${response.status} ${await response.text()}`);
    }

    const data = await response.json();
    const content = data.content[0].text;
    const figures = JSON.parse(content) as GeneratedFigure[];

    return {
      figures,
      inputTokens: data.usage.input_tokens,
      outputTokens: data.usage.output_tokens,
    };
  }

  private buildSystemPrompt(): string {
    return `You are an expert academic figure designer specializing in top-tier conference papers (CVPR, NeurIPS, Nature, IEEE). Generate figure prompts as a JSON array.`;
  }

  private buildUserMessage(params: GeneratePromptsParams): string {
    // 构建包含论文内容、配色方案、图表类型的提示词
    return `Generate ${params.maxFigures} figure prompts based on the following paper content...`;
  }
}
```

### 9.2 NanoBanana API 客户端 (`src/api/nanobananaClient.ts`)

```typescript
import { fetch } from '@tauri-apps/plugin-http';

export class NanobananaClient {
  constructor(
    private apiKey: string,
    private baseUrl: string
  ) {}

  async generateImage(params: {
    prompt: string;
    resolution: '1K' | '2K' | '4K';
    aspectRatio: string;
  }): Promise<{ imageBase64: string; durationMs: number }> {
    const start = Date.now();
    const response = await fetch(`${this.baseUrl}/generate`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt: params.prompt,
        resolution: params.resolution,
        aspect_ratio: params.aspectRatio,
      }),
    });

    if (!response.ok) {
      throw new Error(`NanoBanana API error: ${response.status}`);
    }

    const data = await response.json();
    return {
      imageBase64: data.image,
      durationMs: Date.now() - start,
    };
  }

  async editImage(params: {
    referenceImageBase64: string;
    instruction: string;
    resolution: '1K' | '2K' | '4K';
    aspectRatio: string;
  }): Promise<{ imageBase64: string; durationMs: number }> {
    const start = Date.now();
    const response = await fetch(`${this.baseUrl}/edit`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        reference_image: params.referenceImageBase64,
        instruction: params.instruction,
        resolution: params.resolution,
        aspect_ratio: params.aspectRatio,
      }),
    });

    if (!response.ok) {
      throw new Error(`NanaBanana edit API error: ${response.status}`);
    }

    const data = await response.json();
    return {
      imageBase64: data.image,
      durationMs: Date.now() - start,
    };
  }
}
```

---

## 10. 加密存储方案

API Key 使用 `tauri-plugin-stronghold` 存储，底层基于 IOTA Stronghold (ChaCha20-Poly1305)。

### 10.1 SecureStorage 封装 (`src/lib/encryption.ts`)

```typescript
import { Client, Stronghold } from '@tauri-apps/plugin-stronghold';
import { appDataDir } from '@tauri-apps/api/path';

const VAULT_PATH_SUFFIX = 'secure.hold';
const CLIENT_PATH = 'api-keys-client';

const KEYS = {
  CLAUDE_API_KEY: 'claude_api_key',
  CLAUDE_BASE_URL: 'claude_base_url',
  CLAUDE_MODEL: 'claude_model',
  NANOBANANA_API_KEY: 'nanobanana_api_key',
  NANOBANANA_BASE_URL: 'nanobanana_base_url',
  OCR_SERVER_URL: 'ocr_server_url',
  OCR_TOKEN: 'ocr_token',
} as const;

export class SecureStorage {
  private static instance: SecureStorage;
  private stronghold: Stronghold | null = null;
  private client: Client | null = null;

  static getInstance(): SecureStorage {
    if (!this.instance) this.instance = new SecureStorage();
    return this.instance;
  }

  async init(password: string): Promise<void> {
    const dataDir = await appDataDir();
    const vaultPath = `${dataDir}/${VAULT_PATH_SUFFIX}`;
    this.stronghold = await Stronghold.load(vaultPath, password);
    try {
      this.client = await this.stronghold.loadClient(CLIENT_PATH);
    } catch {
      this.client = await this.stronghold.createClient(CLIENT_PATH);
    }
  }

  async saveApiConfig(config: {
    claudeApiKey: string;
    claudeBaseUrl: string;
    claudeModel: string;
    nanobananaApiKey: string;
    nanobananaBaseUrl: string;
    ocrServerUrl?: string;
    ocrToken?: string;
  }): Promise<void> {
    const store = this.client!.getStore();
    const encoder = new TextEncoder();

    const entries = [
      [KEYS.CLAUDE_API_KEY, config.claudeApiKey],
      [KEYS.CLAUDE_BASE_URL, config.claudeBaseUrl],
      [KEYS.CLAUDE_MODEL, config.claudeModel],
      [KEYS.NANOBANANA_API_KEY, config.nanobananaApiKey],
      [KEYS.NANOBANANA_BASE_URL, config.nanobananaBaseUrl],
      [KEYS.OCR_SERVER_URL, config.ocrServerUrl ?? ''],
      [KEYS.OCR_TOKEN, config.ocrToken ?? ''],
    ] as const;

    for (const [key, value] of entries) {
      await store.insert(key, Array.from(encoder.encode(value)));
    }
    await this.stronghold!.save();
  }

  async getApiConfig() {
    const store = this.client!.getStore();
    const decoder = new TextDecoder();
    const get = async (key: string) => {
      const bytes = await store.get(key);
      return bytes ? decoder.decode(new Uint8Array(bytes)) : '';
    };

    return {
      claudeApiKey: await get(KEYS.CLAUDE_API_KEY),
      claudeBaseUrl: await get(KEYS.CLAUDE_BASE_URL) || 'https://api.anthropic.com',
      claudeModel: await get(KEYS.CLAUDE_MODEL) || 'claude-opus-4-5',
      nanobananaApiKey: await get(KEYS.NANOBANANA_API_KEY),
      nanobananaBaseUrl: await get(KEYS.NANOBANANA_BASE_URL),
      ocrServerUrl: await get(KEYS.OCR_SERVER_URL) || undefined,
      ocrToken: await get(KEYS.OCR_TOKEN) || undefined,
    };
  }
}
```

**注意**：Stronghold 需要一个密码来加密 vault。桌面版策略：使用机器唯一标识（`machine-id` crate 或 macOS `IOPlatformUUID`）派生密码，对用户透明，无需手动输入密码。

---

## 11. 文档解析方案

### 11.1 PDF 解析 (pdf.js)

```typescript
import * as pdfjsLib from 'pdfjs-dist';
import { readFile, BaseDirectory } from '@tauri-apps/plugin-fs';

pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.js';

export async function parsePdf(filePath: string): Promise<{
  fullText: string;
  sections: DocumentSection[];
  pageCount: number;
}> {
  const bytes = await readFile(filePath, { baseDir: BaseDirectory.AppData });
  const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;

  const pageTexts: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const text = content.items
      .map((item: { str: string }) => item.str)
      .join(' ');
    pageTexts.push(text);
  }

  const fullText = pageTexts.join('\n\n');
  const sections = extractSections(fullText);

  return { fullText, sections, pageCount: pdf.numPages };
}
```

### 11.2 DOCX 解析 (mammoth.js)

```typescript
import mammoth from 'mammoth';
import { readFile, BaseDirectory } from '@tauri-apps/plugin-fs';

export async function parseDocx(filePath: string): Promise<{
  fullText: string;
  sections: DocumentSection[];
}> {
  const bytes = await readFile(filePath, { baseDir: BaseDirectory.AppData });
  const buffer = Buffer.from(bytes);
  const result = await mammoth.extractRawText({ buffer });
  const fullText = result.value;
  const sections = extractSections(fullText);
  return { fullText, sections };
}
```

### 11.3 章节提取启发式算法

```typescript
function extractSections(text: string): DocumentSection[] {
  // 匹配 "1. Introduction", "2.1 Method", "Abstract" 等章节标题模式
  const sectionPattern = /^(\d+\.?\d*\.?\s+[A-Z][^\n]{3,80}|Abstract|Introduction|Conclusion|Related Work|Methodology|Experiments?|Results?)/gm;
  const sections: DocumentSection[] = [];
  let lastIndex = 0;
  let lastTitle = 'Preamble';
  let lastLevel = 1;

  for (const match of text.matchAll(sectionPattern)) {
    if (match.index! > lastIndex) {
      sections.push({
        title: lastTitle,
        content: text.slice(lastIndex, match.index).trim(),
        level: lastLevel,
      });
    }
    lastTitle = match[0].trim();
    lastLevel = lastTitle.match(/^\d+\.\d+/) ? 2 : 1;
    lastIndex = match.index! + match[0].length;
  }

  // 最后一节
  if (lastIndex < text.length) {
    sections.push({ title: lastTitle, content: text.slice(lastIndex).trim(), level: lastLevel });
  }

  return sections.filter(s => s.content.length > 50);
}
```

---

## 12. 构建与发布流程

### 12.1 依赖安装

```bash
# Rust 工具链
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
rustup target add aarch64-apple-darwin x86_64-apple-darwin  # macOS universal
rustup target add x86_64-pc-windows-msvc                    # Windows

# 前端依赖
pnpm install

# Tauri CLI
pnpm add -D @tauri-apps/cli
```

### 12.2 开发模式

```bash
pnpm tauri dev
```

### 12.3 生产构建

```bash
# macOS (当前架构)
pnpm tauri build

# macOS Universal Binary (Intel + Apple Silicon)
pnpm tauri build --target universal-apple-darwin

# Windows (需在 Windows 或 cross-compilation)
pnpm tauri build --target x86_64-pc-windows-msvc
```

### 12.4 输出产物

| 平台 | 产物 | 位置 |
|------|------|------|
| macOS | `.app` + `.dmg` | `src-tauri/target/release/bundle/dmg/` |
| macOS Universal | `.app` + `.dmg` | `src-tauri/target/universal-apple-darwin/release/bundle/` |
| Windows | `.exe` + `.msi` | `src-tauri/target/release/bundle/msi/` |

### 12.5 GitHub Actions CI/CD

```yaml
# .github/workflows/release.yml
name: Release

on:
  push:
    tags:
      - 'v*'

jobs:
  build-macos:
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
        with:
          targets: aarch64-apple-darwin,x86_64-apple-darwin
      - uses: pnpm/action-setup@v3
      - run: pnpm install
      - run: pnpm tauri build --target universal-apple-darwin
      - uses: actions/upload-artifact@v4
        with:
          name: macos-dmg
          path: src-tauri/target/universal-apple-darwin/release/bundle/dmg/*.dmg

  build-windows:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
      - uses: pnpm/action-setup@v3
      - run: pnpm install
      - run: pnpm tauri build
      - uses: actions/upload-artifact@v4
        with:
          name: windows-msi
          path: src-tauri/target/release/bundle/msi/*.msi
```

### 12.6 版本管理

版本号同步更新以下文件：
- `package.json` → `version`
- `src-tauri/Cargo.toml` → `version`
- `src-tauri/tauri.conf.json` → `version`

使用脚本自动同步：

```bash
# scripts/bump-version.sh
NEW_VERSION=$1
sed -i '' "s/\"version\": \".*\"/\"version\": \"${NEW_VERSION}\"/" package.json
sed -i '' "s/^version = \".*\"/version = \"${NEW_VERSION}\"/" src-tauri/Cargo.toml
```

---

## 13. 开发环境搭建

### 13.1 系统要求

**macOS**:
- macOS 11.0+
- Xcode Command Line Tools: `xcode-select --install`
- Node.js 20+
- pnpm: `npm install -g pnpm`
- Rust: `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`

**Windows**:
- Windows 10/11
- Microsoft C++ Build Tools (via Visual Studio Installer)
- WebView2 Runtime
- Node.js 20+
- pnpm
- Rust

### 13.2 首次设置

```bash
git clone https://github.com/your-org/academic-figure-generator-desktop.git
cd academic-figure-generator-desktop

# 安装依赖
pnpm install

# 启动开发服务器（含热重载）
pnpm tauri dev
```

### 13.3 VSCode 推荐扩展

```json
// .vscode/extensions.json
{
  "recommendations": [
    "rust-lang.rust-analyzer",
    "tauri-apps.tauri-vscode",
    "bradlc.vscode-tailwindcss",
    "dbaeumer.vscode-eslint",
    "esbenp.prettier-vscode"
  ]
}
```

### 13.4 环境变量（开发用，非 API Key）

```bash
# .env.development (不含敏感信息)
VITE_APP_VERSION=1.0.0-dev
VITE_DEV_MODE=true
```

API Key 不通过环境变量传递，始终通过 Stronghold 安全存储。

---

## 14. 关键移植细节（Python → TypeScript）

本节包含从 Web 版 Python 后端移植到桌面版时**必须精确复制**的核心逻辑。

### 14.1 系统提示词移植

**源文件**: `backend/app/core/prompts/system_prompt.py`

系统提示词（约 550 行英文文本）是核心 IP，必须**原样复制**为 TypeScript 字符串常量：

```typescript
// src/core/prompts/systemPrompt.ts

// 从 backend/app/core/prompts/system_prompt.py 原样复制
// 包含两个常量：
export const ACADEMIC_FIGURE_SYSTEM_PROMPT = `...`;  // 主系统提示词
export const TEMPLATE_FIGURE_SYSTEM_PROMPT = `...`;  // 模板模式系统提示词
```

### 14.2 配色方案移植（修正：8 种语义角色）

**源文件**: `backend/app/core/prompts/color_schemes.py`

**重要**：配色方案的 8 种语义角色名称为：

| 角色 | 说明 |
|------|------|
| `primary` | 主色，关键结构元素 |
| `secondary` | 次色，辅助高亮 |
| `tertiary` | 第三色，支撑元素 |
| `text` | 所有文本和标签 |
| `fill` | 画布背景（必须为白色或近白色） |
| `section_bg` | 面板/子区域背景色调 |
| `border` | 边框和分隔线 |
| `arrow` | 流程箭头和连接线 |

```typescript
// src/core/prompts/colorSchemes.ts

export interface ColorValues {
  primary: string;
  secondary: string;
  tertiary: string;
  text: string;
  fill: string;
  section_bg: string;
  border: string;
  arrow: string;
}

// 9 种预设配色方案（从 Python 原样移植）
export const OKABE_ITO: ColorValues = {
  primary:    "#0072B2",  // Blue
  secondary:  "#E69F00",  // Orange
  tertiary:   "#009E73",  // Green
  text:       "#333333",  // Dark gray
  fill:       "#FFFFFF",  // White
  section_bg: "#F7F7F7",  // Off-white
  border:     "#CCCCCC",  // Light gray
  arrow:      "#4D4D4D",  // Mid gray
};

export const BLUE_MONOCHROME: ColorValues = {
  primary:    "#1565C0",
  secondary:  "#42A5F5",
  tertiary:   "#90CAF9",
  text:       "#212121",
  fill:       "#FFFFFF",
  section_bg: "#F5F8FC",
  border:     "#B0BEC5",
  arrow:      "#37474F",
};

export const WARM_EARTH: ColorValues = {
  primary:    "#C0392B",
  secondary:  "#E67E22",
  tertiary:   "#F39C12",
  text:       "#2C2C2C",
  fill:       "#FFFFFF",
  section_bg: "#FDF6EC",
  border:     "#D5C5A1",
  arrow:      "#5D4037",
};

export const PURPLE_GREEN: ColorValues = {
  primary:    "#6A1B9A",
  secondary:  "#2E7D32",
  tertiary:   "#AB47BC",
  text:       "#1A1A1A",
  fill:       "#FFFFFF",
  section_bg: "#F8F5FC",
  border:     "#CE93D8",
  arrow:      "#4A148C",
};

export const GRAYSCALE: ColorValues = {
  primary:    "#212121",
  secondary:  "#616161",
  tertiary:   "#9E9E9E",
  text:       "#111111",
  fill:       "#FFFFFF",
  section_bg: "#F5F5F5",
  border:     "#BDBDBD",
  arrow:      "#424242",
};

export const TEAL_CORAL: ColorValues = {
  primary:    "#00695C",
  secondary:  "#E64A19",
  tertiary:   "#26A69A",
  text:       "#212121",
  fill:       "#FFFFFF",
  section_bg: "#F0F9F8",
  border:     "#80CBC4",
  arrow:      "#004D40",
};

export const ML_TOPCONF_TAB10: ColorValues = {
  primary:    "#1F77B4",
  secondary:  "#FF7F0E",
  tertiary:   "#2CA02C",
  text:       "#1F2937",
  fill:       "#FFFFFF",
  section_bg: "#F8FAFC",
  border:     "#CBD5E1",
  arrow:      "#334155",
};

export const ML_TOPCONF_COLORBLIND: ColorValues = {
  primary:    "#0173B2",
  secondary:  "#DE8F05",
  tertiary:   "#029E73",
  text:       "#1F2937",
  fill:       "#FFFFFF",
  section_bg: "#F8FAFC",
  border:     "#CBD5E1",
  arrow:      "#334155",
};

export const ML_TOPCONF_DEEP: ColorValues = {
  primary:    "#4C72B0",
  secondary:  "#DD8452",
  tertiary:   "#55A868",
  text:       "#1F2937",
  fill:       "#FFFFFF",
  section_bg: "#F8FAFC",
  border:     "#CBD5E1",
  arrow:      "#334155",
};

export const PRESET_COLOR_SCHEMES: Record<string, ColorValues> = {
  "okabe-ito":              OKABE_ITO,
  "blue-monochrome":        BLUE_MONOCHROME,
  "warm-earth":             WARM_EARTH,
  "purple-green":           PURPLE_GREEN,
  "grayscale":              GRAYSCALE,
  "teal-coral":             TEAL_CORAL,
  "ml-topconf-tab10":       ML_TOPCONF_TAB10,
  "ml-topconf-colorblind":  ML_TOPCONF_COLORBLIND,
  "ml-topconf-deep":        ML_TOPCONF_DEEP,
};

export const COLOR_SCHEME_DISPLAY_NAMES: Record<string, string> = {
  "okabe-ito":              "Okabe-Ito (Colorblind Safe, Recommended)",
  "blue-monochrome":        "Blue Monochrome (Grayscale Compatible)",
  "warm-earth":             "Warm Earth (Biology / Medical)",
  "purple-green":           "Purple-Green (High Contrast)",
  "grayscale":              "Grayscale (Print-Only)",
  "teal-coral":             "Teal-Coral (HCI / CHI)",
  "ml-topconf-tab10":       "ML TopConf (Matplotlib Tab10)",
  "ml-topconf-colorblind":  "ML TopConf (Seaborn Colorblind)",
  "ml-topconf-deep":        "ML TopConf (Seaborn Deep)",
};

export function getColorScheme(
  name: string,
  customOverrides?: Partial<ColorValues>
): ColorValues {
  const normalized = name.replace(/_/g, "-");
  const base = { ...(PRESET_COLOR_SCHEMES[normalized] ?? OKABE_ITO) };
  if (customOverrides) {
    Object.assign(base, customOverrides);
  }
  return base;
}
```

### 14.3 图表类型移植

**源文件**: `backend/app/core/prompts/figure_types.py`

```typescript
// src/core/prompts/figureTypes.ts

export interface FigureTypeInfo {
  slug: string;
  displayName: string;
  defaultAspectRatio: string;
  description: string;
  typicalContent: string[];
  layoutHint: string;
  typicalPaperSections: string[];
}

export const FIGURE_TYPES: Record<string, FigureTypeInfo> = {
  overall_framework: {
    slug: "overall_framework",
    displayName: "Overall Framework (总体框架图)",
    defaultAspectRatio: "16:9",
    description: "An end-to-end pipeline figure showing the complete flow from raw input through all processing stages to the final output...",
    // 从 Python figure_types.py 复制完整 description
    typicalContent: [
      "Input modality block (image, text, video, point cloud)",
      "Feature extraction / backbone block",
      "Core processing / novel module blocks",
      "Prediction head block",
      "Output visualization",
      "Inter-stage data-flow arrows with tensor shape annotations",
    ],
    layoutHint: "horizontal-pipeline",
    typicalPaperSections: ["Introduction", "Method", "Proposed Approach", "System Overview"],
  },
  network_architecture: {
    slug: "network_architecture",
    displayName: "Network Architecture (网络架构图)",
    defaultAspectRatio: "16:9",
    description: "A detailed layer-by-layer diagram of the neural network...",
    typicalContent: [/* 从 Python 复制 */],
    layoutHint: "horizontal-layers",
    typicalPaperSections: ["Method", "Architecture", "Model Design"],
  },
  module_detail: {
    slug: "module_detail",
    displayName: "Module Detail (模块细节图)",
    defaultAspectRatio: "4:3",
    description: "A close-up figure zooming into one specific novel contribution...",
    typicalContent: [/* 从 Python 复制 */],
    layoutHint: "central-detail-with-context",
    typicalPaperSections: ["Key Component", "Novel Module", "Attention Mechanism"],
  },
  comparison_ablation: {
    slug: "comparison_ablation",
    displayName: "Comparison / Ablation (对比消融图)",
    defaultAspectRatio: "16:9",
    description: "A grid figure comparing the proposed method against baselines...",
    typicalContent: [/* 从 Python 复制 */],
    layoutHint: "comparison-grid",
    typicalPaperSections: ["Experiments", "Results", "Ablation Study"],
  },
  data_behavior: {
    slug: "data_behavior",
    displayName: "Data Behavior (数据行为图)",
    defaultAspectRatio: "4:3",
    description: "A visualization figure showing how data or learned representations behave...",
    typicalContent: [/* 从 Python 复制 */],
    layoutHint: "visualization-panels",
    typicalPaperSections: ["Analysis", "Visualization", "Feature Analysis"],
  },
};
```

### 14.4 Claude API 用户消息构建（精确移植）

**源文件**: `backend/app/tasks/prompt_tasks.py` → `_build_user_prompt`

这是最关键的移植函数，必须与 Python 版完全一致：

```typescript
// src/api/claudeClient.ts 中的完整实现

import { FIGURE_TYPES } from '../core/prompts/figureTypes';
import { ACADEMIC_FIGURE_SYSTEM_PROMPT, TEMPLATE_FIGURE_SYSTEM_PROMPT } from '../core/prompts/systemPrompt';

/**
 * 构建发送给 Claude 的用户消息。
 * 精确移植自 Python: prompt_tasks.py → _build_user_prompt
 */
function buildUserPrompt(
  sections: Array<{ title: string; content: string }>,
  colorScheme: Record<string, string>,
  figureTypes?: string[],
  userRequest?: string,
  maxFigures?: number,
): string {
  // 1. 图表类型提示
  let typeHint = "";
  if (figureTypes && figureTypes.length > 0) {
    const typeDescriptions = figureTypes
      .filter(ft => ft in FIGURE_TYPES)
      .map(ft => `- ${ft}: ${FIGURE_TYPES[ft].description}`);
    if (typeDescriptions.length > 0) {
      typeHint = "\n\nPreferred figure types for this paper:\n" + typeDescriptions.join("\n");
    }
  }

  // 2. 配色方案 JSON
  const colorBlock = JSON.stringify(colorScheme, null, 2);

  // 3. 章节文本
  const sectionText = sections
    .map((s, i) => `## Section ${i + 1}: ${s.title || "Untitled"}\n${s.content}`)
    .join("\n\n");

  // 4. 用户自定义请求
  let requestBlock = "";
  if (userRequest && userRequest.trim()) {
    requestBlock = `\n\nUser requested figures (highest priority):\n${userRequest.trim()}\n`;
  }

  // 5. 数量限制
  let countHint = "";
  if (maxFigures != null && maxFigures > 0) {
    countHint = `Generate at most ${maxFigures} figure prompt(s). `;
  }

  // 6. 组装（与 Python 版完全一致的格式）
  return (
    `Color palette to use (map exactly to the roles described in the system prompt):\n` +
    `\`\`\`json\n${colorBlock}\n\`\`\`` +
    `${typeHint}\n\n` +
    `${requestBlock}\n` +
    `--- PAPER SECTIONS ---\n\n` +
    `${sectionText}\n\n` +
    `--- END OF PAPER ---\n\n` +
    `${countHint}` +
    `Generate figure prompts that best match the user's request and the paper. ` +
    `If no explicit user request is provided, generate one figure prompt per major section above. ` +
    `Never include rulers, margin guides, or any visible measurement text like '16px', '0.5pt', or '75%'. ` +
    `Return ONLY valid JSON array as specified in the system prompt. ` +
    `Each prompt field must be at least 500 words and extremely precise.`
  );
}

/**
 * 模板模式用户消息。
 * 移植自 Python: prompt_tasks.py → _build_template_user_prompt
 */
function buildTemplateUserPrompt(
  colorScheme: Record<string, string>,
  figureTypes?: string[],
  maxFigures?: number,
): string {
  const colorBlock = JSON.stringify(colorScheme, null, 2);

  let countHint = "";
  if (maxFigures != null && maxFigures > 0) {
    countHint = `Generate exactly ${maxFigures} template figure(s). `;
  } else {
    countHint = "Generate 1 template figure. ";
  }

  let typeHint = "";
  if (figureTypes && figureTypes.length > 0) {
    const typeDescriptions = figureTypes
      .filter(ft => ft in FIGURE_TYPES)
      .map(ft => `- ${ft}: ${FIGURE_TYPES[ft].description}`);
    if (typeDescriptions.length > 0) {
      typeHint = "\n\nUse these figure types:\n" + typeDescriptions.join("\n");
    }
  }

  return (
    `Color palette to use (map exactly to the roles described in the system prompt):\n` +
    `\`\`\`json\n${colorBlock}\n\`\`\`` +
    `${typeHint}\n\n` +
    `${countHint}` +
    `Generate purely structural, text-free layout template(s). ` +
    `Do NOT include any text, labels, annotations, numbers, or symbols of any kind. ` +
    `Every element must be a shape, line, or arrow only. ` +
    `Return ONLY valid JSON array as specified in the system prompt.`
  );
}

/**
 * 解析 Claude 返回的 JSON 数组。
 * 移植自 Python: prompt_tasks.py → _parse_figure_prompts
 */
function parseFigurePrompts(rawText: string): Array<{
  figure_number: number;
  title: string;
  figure_type: string;
  suggested_aspect_ratio: string;
  prompt: string;
}> {
  let text = rawText.trim();

  // Claude 有时会用 markdown 代码块包裹 JSON
  if (text.startsWith("```")) {
    const lines = text.split("\n");
    const innerLines = lines.slice(1);
    if (innerLines.length > 0 && innerLines[innerLines.length - 1].trim() === "```") {
      innerLines.pop();
    }
    text = innerLines.join("\n").trim();
  }

  const figures = JSON.parse(text);
  if (!Array.isArray(figures)) {
    throw new Error(`Expected JSON array from Claude, got ${typeof figures}`);
  }
  return figures;
}

/**
 * 规范化 Claude API URL。
 * 移植自 Python: prompt_tasks.py → _normalize_claude_api_url
 */
function normalizeClaudeApiUrl(baseOrFull?: string): string {
  const defaultUrl = "https://api.anthropic.com/v1/messages";
  if (!baseOrFull) return defaultUrl;
  let url = baseOrFull.trim();
  if (!url) return defaultUrl;
  url = url.replace(/\/+$/, "");
  if (url.endsWith("/v1/messages")) return url;
  return `${url}/v1/messages`;
}
```

### 14.5 NanoBanana API 客户端（精确移植）

**源文件**: `backend/app/tasks/image_tasks.py`

**关键：NanoBanana 使用 Gemini 风格 API**，不是简单的 RESTful 接口：

```typescript
// src/api/nanobananaClient.ts — 完整实现

import { fetch } from '@tauri-apps/plugin-http';

// 分辨率 → 基础像素（长边）
const RESOLUTION_BASE_PX: Record<string, number> = {
  '1K': 1024, '2K': 2048, '4K': 4096,
};

// 宽高比 → [宽比, 高比]
const ASPECT_RATIO_MAP: Record<string, [number, number]> = {
  '1:1':  [1, 1],   '4:3':  [4, 3],   '3:4':  [3, 4],
  '16:9': [16, 9],  '9:16': [9, 16],  '3:2':  [3, 2],  '2:3': [2, 3],
};

// 分辨率 → 超时秒数
const RESOLUTION_TIMEOUTS: Record<string, number> = {
  '1K': 360, '2K': 600, '4K': 1140,
};

/**
 * 计算像素尺寸。移植自 Python: _compute_dimensions
 */
export function computeDimensions(
  resolution: string,
  aspectRatio: string
): { width: number; height: number } {
  const basePx = RESOLUTION_BASE_PX[resolution] ?? 2048;
  const ar = ASPECT_RATIO_MAP[aspectRatio] ?? [1, 1];
  const ratio = ar[0] / ar[1];

  let width: number, height: number;
  if (ratio >= 1.0) {
    width = basePx;
    height = Math.floor(basePx / ratio);
  } else {
    height = basePx;
    width = Math.floor(basePx * ratio);
  }
  // 对齐到 64 的倍数
  width = Math.floor(width / 64) * 64;
  height = Math.floor(height / 64) * 64;
  return { width, height };
}

/**
 * 构建 Gemini 风格的 API payload。
 * 移植自 Python: _build_generation_payload
 */
function buildGenerationPayload(
  promptText: string,
  aspectRatio: string,
  imageSize: string,
  colorScheme: string,
): object {
  const stylePrefix =
    "Academic figure, publication-quality, white background, clean vector style, " +
    "no shadows, no 3D effects, professional sans-serif labels, " +
    `color scheme: ${colorScheme}. `;

  return {
    contents: [{ parts: [{ text: stylePrefix + promptText }] }],
    generationConfig: {
      responseModalities: ["IMAGE"],
      imageConfig: {
        aspectRatio: aspectRatio,
        image_size: imageSize,
      },
    },
  };
}

/**
 * 调用 NanoBanana Gemini 风格图片生成 API。
 * 移植自 Python: _call_nanobanana_api
 *
 * API 端点格式：{baseUrl}/v1beta/models/{model}:generateContent
 */
async function callNanoBananaApi(
  payload: object,
  apiKey: string,
  apiBaseUrl: string,
  model: string,
  timeoutMs: number,
): Promise<string> {
  const modelId = (model || "gemini-3-pro-image-preview").trim();
  const endpoint = `${apiBaseUrl.replace(/\/+$/, "")}/v1beta/models/${modelId}:generateContent`;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    // Tauri plugin-http 支持 connectTimeout
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`NanoBanana API error ${response.status}: ${errorText.slice(0, 500)}`);
  }

  const data = await response.json() as any;

  // 从 Gemini 风格响应中提取 base64 图片
  try {
    const parts = data.candidates[0].content.parts;
    const imagePart = parts.find((p: any) => "inlineData" in p);
    if (!imagePart) throw new Error("No image data in response");
    return imagePart.inlineData.data;  // base64 字符串
  } catch (e) {
    throw new Error(`NanoBanana response missing image data: ${JSON.stringify(data).slice(0, 500)}`);
  }
}

/**
 * 检测图片格式和尺寸。
 * 移植自 Python: _detect_image, _get_png_dimensions, _get_jpeg_dimensions
 */
function detectImage(bytes: Uint8Array): {
  ext: string;
  mimeType: string;
  width: number;
  height: number;
} {
  // PNG: 魔术字节 89 50 4E 47 0D 0A 1A 0A
  if (bytes.length >= 24 &&
      bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) {
    const view = new DataView(bytes.buffer, bytes.byteOffset);
    const width = view.getUint32(16, false);   // big-endian, IHDR offset
    const height = view.getUint32(20, false);
    return { ext: "png", mimeType: "image/png", width, height };
  }

  // JPEG: 魔术字节 FF D8
  if (bytes.length >= 4 && bytes[0] === 0xFF && bytes[1] === 0xD8) {
    // 扫描 SOF marker 获取尺寸
    let i = 2;
    while (i + 1 < bytes.length) {
      if (bytes[i] !== 0xFF) { i++; continue; }
      while (i < bytes.length && bytes[i] === 0xFF) i++;
      if (i >= bytes.length) break;
      const marker = bytes[i]; i++;
      if (marker === 0xD8 || marker === 0xD9) continue;
      if (marker >= 0xD0 && marker <= 0xD7) continue;
      if (i + 1 >= bytes.length) break;
      const segLen = (bytes[i] << 8) + bytes[i + 1];
      if (segLen < 2) break;
      const segStart = i + 2;
      // SOF markers: C0-C3, C5-C7, C9-CB, CD-CF
      if ([0xC0,0xC1,0xC2,0xC3,0xC5,0xC6,0xC7,0xC9,0xCA,0xCB,0xCD,0xCE,0xCF].includes(marker)) {
        if (segStart + 5 <= bytes.length) {
          const height = (bytes[segStart + 1] << 8) + bytes[segStart + 2];
          const width = (bytes[segStart + 3] << 8) + bytes[segStart + 4];
          return { ext: "jpg", mimeType: "image/jpeg", width, height };
        }
      }
      i = segStart + (segLen - 2);
    }
    throw new Error("Unable to determine JPEG dimensions");
  }

  throw new Error(`Unsupported image format (header: ${Array.from(bytes.slice(0, 16)).map(b => b.toString(16).padStart(2, '0')).join(' ')})`);
}

/**
 * 生成图片的完整流程。
 */
export async function generateImage(params: {
  promptText: string;
  resolution: string;
  aspectRatio: string;
  colorScheme: string;
  apiKey: string;
  apiBaseUrl: string;
  model?: string;
}): Promise<{
  imageBytes: Uint8Array;
  width: number;
  height: number;
  ext: string;
  mimeType: string;
  durationMs: number;
}> {
  const model = params.model || "gemini-3-pro-image-preview";
  const timeout = (RESOLUTION_TIMEOUTS[params.resolution] ?? 600) * 1000;

  const payload = buildGenerationPayload(
    params.promptText,
    params.aspectRatio,
    params.resolution,
    params.colorScheme,
  );

  const startTime = performance.now();
  const b64Image = await callNanoBananaApi(
    payload, params.apiKey, params.apiBaseUrl, model, timeout
  );
  const durationMs = Math.round(performance.now() - startTime);

  // Base64 解码
  const binaryString = atob(b64Image);
  const imageBytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    imageBytes[i] = binaryString.charCodeAt(i);
  }

  const { ext, mimeType, width, height } = detectImage(imageBytes);

  return { imageBytes, width, height, ext, mimeType, durationMs };
}
```

### 14.6 Web 版关键文件对照表

| Web 版 Python 源文件 | 桌面版 TypeScript 目标 | 移植方式 |
|---|---|---|
| `backend/app/core/prompts/system_prompt.py` | `src/core/prompts/systemPrompt.ts` | **原样复制**字符串常量 |
| `backend/app/core/prompts/color_schemes.py` | `src/core/prompts/colorSchemes.ts` | 移植 9 个方案 + 工具函数（见 14.2） |
| `backend/app/core/prompts/figure_types.py` | `src/core/prompts/figureTypes.ts` | 移植 5 个类型定义（见 14.3） |
| `backend/app/tasks/prompt_tasks.py` → `_build_user_prompt` | `src/api/claudeClient.ts` → `buildUserPrompt` | **精确移植**（见 14.4） |
| `backend/app/tasks/prompt_tasks.py` → `_build_template_user_prompt` | `src/api/claudeClient.ts` → `buildTemplateUserPrompt` | **精确移植**（见 14.4） |
| `backend/app/tasks/prompt_tasks.py` → `_parse_figure_prompts` | `src/api/claudeClient.ts` → `parseFigurePrompts` | **精确移植**（见 14.4） |
| `backend/app/tasks/prompt_tasks.py` → `_call_claude_api` | `src/api/claudeClient.ts` → `callClaudeApi` | 改为 fetch，其余一致 |
| `backend/app/tasks/image_tasks.py` → `_build_generation_payload` | `src/api/nanobananaClient.ts` → `buildGenerationPayload` | **精确移植**（见 14.5） |
| `backend/app/tasks/image_tasks.py` → `_call_nanobanana_api` | `src/api/nanobananaClient.ts` → `callNanoBananaApi` | **精确移植**，Gemini 风格 API |
| `backend/app/tasks/image_tasks.py` → `_detect_image` | `src/api/nanobananaClient.ts` → `detectImage` | **精确移植** PNG/JPEG 检测 |
| `backend/app/tasks/image_tasks.py` → `_compute_dimensions` | `src/api/nanobananaClient.ts` → `computeDimensions` | **精确移植**（见 14.5） |
| `backend/app/services/document_service.py` | `src/lib/documentParser.ts` | 用 pdf.js + mammoth 替代 |
| `backend/app/models/*.py` | `src/types/models.ts` + SQLite DDL | 去掉 user_id，UUID→TEXT |

---

*本文档随项目演进持续更新。如有疑问，请在 GitHub Issues 中提交。*
