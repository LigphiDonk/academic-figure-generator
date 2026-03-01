# VPS 部署（Docker + GitHub 更新）

## 1) VPS 准备

- 安装 Docker / Docker Compose（按你的发行版官方文档即可）
- 对外只需要开放你的“总反代”使用的端口：通常 `80/443`

## 2) 首次部署

```bash
git clone <你的仓库地址> academic-figure-generator
cd academic-figure-generator

# 复制 docker 环境变量模板
cp .env.docker.example .env

# 编辑 .env：至少改 POSTGRES_PASSWORD / MINIO_SECRET_KEY / SECRET_KEY / ENCRYPTION_MASTER_KEY
# 注意：API_V1_PREFIX 建议保持为 `/api/v1`（不要以 `/` 结尾）
# 如果要直接生成图片：三选一即可
# 1) 管理员后台 → 系统设置：配置 NanoBanana 系统 Key（推荐）
# 2) `.env`：配置 `NANOBANANA_API_KEY`（平台统一 Key）
# 3) 用户设置：填写 BYOK Key（仅该用户可用）
```

启动：

```bash
# 推荐：本项目 nginx 仅绑定到本机端口，由你 VPS 上的“总反代”(占用 80/443) 转发过来
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

访问：
- 直接访问（如果防火墙放行）：`http://<VPS_IP>:${APP_HTTP_PORT:-8082}/`
- 用域名访问：让你的“总反代”(80/443) 转发到 `http://127.0.0.1:${APP_HTTP_PORT:-8082}`

## 3) 常用运维

查看日志：

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml logs -f --tail=200 backend
docker compose -f docker-compose.yml -f docker-compose.prod.yml logs -f --tail=200 celery-worker
docker compose -f docker-compose.yml -f docker-compose.prod.yml logs -f --tail=200 minio
```

重启服务：

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml restart
```

## 4) 通过 GitHub 快速更新

每次你 push 到 GitHub 后，在 VPS 上执行：

```bash
cd academic-figure-generator
git pull
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

说明：
- 这会重新 build 前端（在 `nginx` 镜像里多阶段构建）并重启相关容器。
- 数据（Postgres/Redis/MinIO）都在 Docker volume 里，不会因为更新丢失。
