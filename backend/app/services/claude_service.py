"""历史导入路径占位模块。

主链路已经迁移到 ``PromptAIService``。保留这个模块的唯一目的，是在旧导入
路径被误用时返回明确错误，而不是因为历史专用配置不存在而产生隐晦异常。
"""

from __future__ import annotations


class ClaudeService:
    """已废弃的历史服务名。"""

    def __init__(self, *_args, **_kwargs) -> None:
        raise RuntimeError(
            "ClaudeService 已废弃，请改用 PromptAIService，并使用 prompt_ai_* 配置字段。"
        )
