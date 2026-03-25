# Academic Figure Generator (Backend)

FastAPI backend service for Academic Figure Generator.

文本提示词生成链路已统一抽象为 `Prompt AI`，当前支持：

- `anthropic`
- `openai-compatible`

系统默认配置通过以下环境变量提供：

- `PROMPT_AI_PROVIDER`
- `PROMPT_AI_API_KEY`
- `PROMPT_AI_API_BASE_URL`
- `PROMPT_AI_MODEL`
- `PROMPT_AI_MAX_TOKENS`
