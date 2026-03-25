<p align="center">
  <img src="./logo.png" alt="Academic Figure Generator Logo" width="220" />
</p>

# Academic Figure Generator

![Python](https://img.shields.io/badge/Python-3.12+-3776AB?logo=python&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-0.115+-009688?logo=fastapi&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)
![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?logo=docker&logoColor=white)
[![License](https://img.shields.io/badge/License-MIT-green)](./LICENSE)

AI 驱动的学术论文配图生成平台。上传论文 → AI 分析内容生成 Prompt → 一键生成高质量科研配图。

现已更新桌面端应用，仓库同时包含 Web 端与桌面端形态，便于在本地环境中完成论文解析、Prompt 生成与配图工作流。

> **一句话**：把"写完论文还要画图"的痛点，变成「上传 → 确认 → 下载」三步流程。

## 示例配图

以下均为本平台实际生成的学术配图示例：

<table>
<tr>
<td align="center" width="50%">
<img src="docs/images/example-architecture.png" alt="网络架构图示例" />
<br/><sub><b>PMST 预测网络架构图</b></sub>
</td>
<td align="center" width="50%">
<img src="docs/images/example-signal.png" alt="信号处理流程图示例" />
<br/><sub><b>时频域信号处理流程图</b></sub>
</td>
</tr>
<tr>
<td align="center" width="50%">
<img src="docs/images/example-network.png" alt="深度学习模块详图示例" />
<br/><sub><b>深度学习模块详解图</b></sub>
</td>
<td align="center" width="50%">
<img src="docs/images/example-anatomy.png" alt="带标注的解剖图示例" />
<br/><sub><b>带标注的解剖结构图</b></sub>
</td>
</tr>
</table>

## 功能特性

| 功能 | 说明 |
|------|------|
| 🤖 **智能 Prompt 生成** | 上传 PDF/DOCX/TXT 论文，提示词生成 AI 自动分析内容并生成配图描述 |
| 🖼️ **高质量配图** | 支持 1K/2K/4K 多分辨率，16:9/4:3/1:1 等多种比例 |
| 🎨 **配色方案** | 50+ 预设学术配色（含色盲友好方案），支持自定义配色 |
| ✏️ **图生图编辑** | 基于已有图片 + 文字指令进行二次编辑 |
| ⚡ **实时状态** | SSE 流式推送生成进度，无需手动刷新 |
| 🖥️ **桌面端应用** | 已更新桌面端版本，提供更适合本地使用的学术配图生成体验 |
| 📁 **项目管理** | 按项目组织论文、Prompt 和配图 |
| 👥 **多用户** | 完整的注册/登录体系，支持 Linux DO OAuth 登录 |
| 🔑 **BYOK** | 用户可配置自己的 API Key（Anthropic / OpenAI Compatible / NanoBanana），也可使用平台统一 Key |
| 💰 **计费系统** | 统一余额 (CNY) 计费，支持 Linux DO 积分自助充值 |
| 🛠️ **管理后台** | API Key 管理、计费配置、用户管理、用量统计 |

## AI 学术配图 Prompt 技能（AI Coding Agent Skill）

本项目附带了一个独立的 **AI Coding Agent Skill**——`academic-figure-prompt`，兼容多种 AI 编程助手（Claude Code / Gemini CLI / Cursor 等），无需部署完整平台即可获得顶会级学术论文配图提示词生成能力。

### 功能简介

`academic-figure-prompt` 是一个专为学术论文设计的 AI 提示词生成器，能够：

- 📄 阅读并分析论文内容（PDF / LaTeX / Word）
- 🎨 提供 **8 种预设学术配色方案**（Okabe-Ito、Blue 单色系、Teal+Amber 等），含色盲友好选项
- 🖼️ 生成极其详细的英文提示词，用于 AI 图片工具（NanoBanana / Gemini / DALL-E / Midjourney）生成顶会级别的专业配图
- 📐 覆盖多种图表类型：框架图、网络架构图、模块详解图、对比/消融图、数据模板图

### 安装方式

#### 方式 1：使用 npx skills 一键安装（推荐）

```bash
npx skills add LigphiDonk/academic-figure-generator
```

该命令会自动将 `academic-figure-prompt` skill 安装到当前项目中，适用于所有支持 Skills 的 AI 编程助手。

#### 方式 2：手动安装

```bash
# 克隆仓库
git clone https://github.com/LigphiDonk/academic-figure-generator.git

# 将 skill 目录复制到你的项目中（Gemini CLI）
cp -r academic-figure-generator/academic-figure-prompt .gemini/skills/
# 或者对于 Claude Code
cp -r academic-figure-generator/academic-figure-prompt .claude/skills/
```

### 使用方法

安装后，在 AI 编程助手对话中直接触发即可。Skill 会在检测到以下关键词时自动激活：

| 触发关键词 | 说明 |
|------------|------|
| `论文配图提示词` / `生成论文配图` | 为论文生成配图提示词 |
| `学术论文生图` / `架构图提示词` | 生成架构图/框架图提示词 |
| `顶会风格配图` / `CVPR 风格图` / `NeurIPS 风格图` | 指定顶会风格 |
| `paper figure prompt` / `academic diagram prompt` | 英文触发 |

**示例对话：**

```
You: 帮我看一下这篇论文，生成论文配图提示词
AI:  [分析论文内容 → 展示配色方案选择 → 生成详细英文提示词]

You: 用 Teal+Amber 配色，帮我画一个网络架构图的提示词
AI:  [直接使用方案C生成网络架构图提示词]
```

### 工作流程

1. **上传/指定论文** → Skill 自动解析论文内容和结构
2. **选择配色方案** → 从 8 种预设方案中选择，或自定义色值
3. **生成提示词** → 自动生成包含完整层次结构的详细英文提示词
4. **质量自检** → 按照内置清单自动检查信息密度、色彩、标注等

> 💡 **提示**：生成的提示词可直接用于 NanoBanana / Gemini / DALL-E / Midjourney 等 AI 图片生成工具，生成效果最佳的是 NanoBanana。

---

## 技术栈

| 层级 | 技术 |
|------|------|
| 后端 | FastAPI · SQLAlchemy (Async) · Celery · Python 3.12+ |
| 前端 | React 19 · TypeScript · Vite · Tailwind CSS · Radix UI |
| 数据库 | PostgreSQL 16 · Redis 7 |
| 存储 | MinIO (S3 兼容) |
| AI | Prompt AI（Anthropic / OpenAI Compatible，用于 Prompt 生成）· NanoBanana API（用于配图生成） |
| 桌面端 | Desktop App（与仓库内 `desktop/` 目录对应） |
| 部署 | Docker Compose · Nginx |

## 项目结构

```
academic-figure-generator/
├── backend/                  # FastAPI 后端
│   ├── app/
│   │   ├── api/v1/           # API 路由 (auth, projects, prompts, images, payment, admin...)
│   │   ├── models/           # SQLAlchemy ORM 模型
│   │   ├── schemas/          # Pydantic 请求/响应 Schema
│   │   ├── services/         # 业务逻辑层
│   │   ├── tasks/            # Celery 异步任务
│   │   ├── core/             # 安全、中间件、异常、Prompt 模板
│   │   ├── config.py         # 环境变量配置
│   │   └── main.py           # FastAPI 应用工厂
│   ├── alembic/              # 数据库迁移
│   ├── pyproject.toml
│   └── Dockerfile
├── frontend/                 # React SPA 前端
│   ├── src/
│   │   ├── pages/            # 页面组件
│   │   ├── components/ui/    # Radix UI 组件库
│   │   ├── store/            # Zustand 状态管理
│   │   └── lib/              # API 客户端、工具函数
│   ├── package.json
│   └── vite.config.ts
├── desktop/                  # 桌面端应用目录
├── nginx/                    # Nginx 反向代理 + 前端多阶段构建
│   ├── nginx.conf
│   └── Dockerfile
├── docker-compose.yml        # 开发/基础编排
├── docker-compose.prod.yml   # 生产覆盖配置
├── Makefile                  # 常用命令快捷方式
└── .env.example              # 环境变量模板
```

## 桌面端应用更新

仓库现已加入更新后的桌面端应用内容，适合需要在本地环境中直接处理论文文件、生成 Prompt 并完成科研配图的使用场景。

如果你主要关注浏览器访问和服务端部署，继续使用下方的 Web 端启动方式即可；如果你要继续完善或打包桌面端，可以从 [`desktop/`](/Users/donkfeng/Desktop/科研配图/academic-figure-generator/desktop) 目录开始。

## 快速开始

### 前置要求

- [Docker](https://docs.docker.com/get-docker/) 和 [Docker Compose](https://docs.docker.com/compose/install/)
- 至少一个 AI API Key（Prompt AI 或 NanoBanana，可部署后在管理后台配置）

### 1. 克隆仓库

```bash
git clone https://github.com/LigphiDonk/academic-figure-generator.git
cd academic-figure-generator
```

### 2. 配置环境变量

```bash
cp .env.docker.example .env
```

编辑 `.env`，**必须修改**以下字段：

```bash
# 数据库密码（随意设置一个强密码）
POSTGRES_PASSWORD=your_secure_password

# MinIO 存储密码
MINIO_SECRET_KEY=your_minio_secret

# 应用密钥（用于 JWT 签发，至少 32 字符）
SECRET_KEY=your_random_secret_key_at_least_32_chars

# 加密主密钥（用于 AES-256 加密存储的 API Key）
# 生成方式: python -c "import secrets; print(secrets.token_hex(32))"
ENCRYPTION_MASTER_KEY=your_64_char_hex_string
```

### 3. 启动服务

**开发模式**（带热重载）：

```bash
make dev
# 或
docker compose up --build
```

**生产模式**：

```bash
make prod-up
# 或
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

### 4. 访问

| 服务 | 地址 |
|------|------|
| 应用首页 | http://localhost:8082 |
| API 文档 (Swagger) | http://localhost:8082/docs（仅开发模式） |
| MinIO 控制台 | http://localhost:9001 |

### 5. 初始配置

1. 使用默认管理员账号登录：`admin@admin.com` / `admin`
2. 进入 **系统管理** 页面，配置：
   - **提示词生成 AI** — 用于 Prompt 生成，可选择 `anthropic` 或 `openai-compatible`
   - **NanoBanana API Key** — 用于配图生成
   - **计费参数** — 图片单价、汇率等
3. （可选）配置 Linux DO OAuth 登录
4. （可选）配置 Linux DO 积分支付（EasyPay）

> **请务必在首次登录后修改管理员密码！**

## API Key 配置说明

系统支持三级 API Key 优先级：

| 优先级 | 来源 | 说明 |
|--------|------|------|
| 1（最高）| 用户 BYOK | 用户在「设置」页面自行配置的 Key |
| 2 | 管理后台系统 Key | 管理员在「系统管理」中配置的平台统一 Key |
| 3 | 环境变量 | `.env` 中的 `PROMPT_AI_*` / `NANOBANANA_API_KEY` |

所有 API Key 均使用 AES-256-GCM 加密存储，数据库中不存在明文 Key。

## Linux DO 集成

### OAuth 登录

1. 在 [Linux DO](https://linux.do) 开发者设置中创建 OAuth 应用
2. 回调地址填写：`https://你的域名/api/v1/auth/linuxdo/callback`
3. 在管理后台填入 Client ID 和 Client Secret

### 积分充值（EasyPay）

1. 在 Linux DO 申请 EasyPay 商户
   - 应用主页：`https://你的域名`
   - 通知地址：`https://你的域名/api/v1/payment/notify`
2. 在管理后台填入 PID、Key 和积分兑换比率
3. 用户即可在「用量看板」使用 Linux DO 积分自助充值

## 常用命令

```bash
make help           # 查看所有可用命令

# 开发
make dev            # 启动开发环境（前台运行，带日志）
make up             # 启动开发环境（后台运行）
make down           # 停止服务
make logs           # 查看日志

# 数据库
make migrate        # 执行数据库迁移
make migrate-create MSG="描述"  # 创建新迁移

# 代码质量
make lint           # 运行 linter
make format         # 自动格式化代码
make test           # 运行测试
make test-cov       # 运行测试 + 覆盖率报告

# 生产
make prod-up        # 启动生产环境
make prod-down      # 停止生产环境

# 调试
make shell          # 进入后端容器 Shell
make dbshell        # 进入 PostgreSQL Shell
make redis-cli      # 进入 Redis CLI

# 清理
make clean          # 删除所有容器、卷和镜像（⚠️ 会丢失数据）
```

## VPS 部署

### 首次部署

```bash
git clone <仓库地址> academic-figure-generator
cd academic-figure-generator

cp .env.docker.example .env
# 编辑 .env，配置必要的密码和密钥

docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

### 更新部署

```bash
cd academic-figure-generator
git pull
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

数据（PostgreSQL / Redis / MinIO）存储在 Docker Volume 中，更新不会丢失。

### 反向代理

应用内置 Nginx 默认绑定到 `APP_HTTP_PORT`（默认 8082）。建议在 VPS 上使用 Caddy 或 Nginx 作为总反代，将 80/443 端口转发到本应用：

```nginx
# Nginx 示例
server {
    listen 443 ssl;
    server_name fig.yourdomain.com;

    location / {
        proxy_pass http://127.0.0.1:8082;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # SSE 支持
        proxy_buffering off;
        proxy_cache off;
    }
}
```

## 架构概览

```
用户浏览器
    │
    ▼
  Nginx (静态文件 + 反向代理)
    │
    ├──► React SPA (前端)
    │
    └──► FastAPI (后端 API)
            │
            ├── PostgreSQL (用户、项目、Prompt、图片元数据)
            ├── Redis (JWT 缓存、Celery 消息队列)
            ├── MinIO (图片文件存储)
            │
            └── Celery Workers
                 ├── Prompt AI → Prompt 生成
                 └── NanoBanana API → 图片生成
```

### 核心流程

1. **上传论文** → 后端解析 PDF/DOCX 提取文本和章节结构
2. **生成 Prompt** → Celery 任务调用 Prompt AI，分析论文内容生成配图描述
3. **生成配图** → 用户确认/编辑 Prompt 后，Celery 任务调用 NanoBanana API 生成图片
4. **实时反馈** → SSE 推送生成进度，前端实时更新状态
5. **下载管理** → 图片存储在 MinIO，通过预签名 URL 下载

## 环境变量参考

| 变量 | 必填 | 默认值 | 说明 |
|------|------|--------|------|
| `SECRET_KEY` | 是 | — | 应用密钥，用于 JWT 等 |
| `POSTGRES_PASSWORD` | 是 | — | PostgreSQL 密码 |
| `MINIO_SECRET_KEY` | 是 | — | MinIO Secret Key |
| `ENCRYPTION_MASTER_KEY` | 是 | — | AES-256 加密主密钥（64 字符 hex） |
| `APP_ENV` | 否 | `development` | `development` / `production` |
| `DEBUG` | 否 | `true` | 是否启用调试模式和 API 文档 |
| `APP_HTTP_PORT` | 否 | `8082` | Nginx 对外端口 |
| `POSTGRES_HOST` | 否 | `postgres` | 数据库主机 |
| `POSTGRES_PORT` | 否 | `5432` | 数据库端口 |
| `POSTGRES_USER` | 否 | `afg_user` | 数据库用户 |
| `POSTGRES_DB` | 否 | `academic_figure_generator` | 数据库名 |
| `REDIS_URL` | 否 | `redis://redis:6379/0` | Redis 连接地址 |
| `MINIO_ENDPOINT` | 否 | `minio:9000` | MinIO 地址 |
| `MINIO_ACCESS_KEY` | 否 | `minioadmin` | MinIO Access Key |
| `MINIO_BUCKET_NAME` | 否 | `academic-figures` | MinIO 存储桶名 |
| `PROMPT_AI_PROVIDER` | 否 | `anthropic` | 提示词生成 Provider，支持 `anthropic` / `openai-compatible` |
| `PROMPT_AI_API_KEY` | 否 | — | 提示词生成 API Key（可在管理后台配置） |
| `PROMPT_AI_API_BASE_URL` | 否 | `""` | 提示词生成 API 基础地址，留空使用 Provider 默认值 |
| `PROMPT_AI_MODEL` | 否 | `claude-sonnet-4-20250514` | 提示词生成模型 |
| `PROMPT_AI_MAX_TOKENS` | 否 | `8192` | 提示词生成最大输出 Tokens |
| `NANOBANANA_API_KEY` | 否 | — | NanoBanana API Key（可在管理后台配置） |
| `NANOBANANA_API_BASE` | 否 | `https://api.ikuncode.cc` | NanoBanana API 地址 |
| `CORS_ORIGINS` | 否 | `["http://localhost:3000","http://localhost:5173"]` | CORS 允许来源 |

## 开发指南

### 后端开发

```bash
# 进入后端容器
make shell

# 创建数据库迁移
alembic revision --autogenerate -m "add new table"

# 执行迁移
alembic upgrade head

# 运行测试
pytest -v

# 代码检查
ruff check app/
ruff format app/
```

### 前端开发

```bash
cd frontend
npm install
npm run dev     # 启动开发服务器 (localhost:5173)
npm run build   # 生产构建
npm run lint    # ESLint 检查
```

前端开发服务器会自动将 `/api` 请求代理到 `localhost:8000`。

## 许可证

本项目基于 [MIT License](./LICENSE) 开源。

这意味着你可以在保留原始版权和许可证声明的前提下，自由使用、修改、分发和商业化本项目。

项目依赖的第三方库仍分别遵循其各自的许可证条款。
