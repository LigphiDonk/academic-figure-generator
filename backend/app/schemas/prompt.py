from datetime import datetime

from pydantic import BaseModel, ConfigDict


class PromptGenerateRequest(BaseModel):
    section_indices: list[int] | None = None  # None means all sections
    color_scheme: str = "okabe-ito"
    custom_colors: dict | None = None
    figure_types: list[str] | None = None
    user_request: str | None = None
    max_figures: int | None = None
    template_mode: bool = False
    use_web_references: bool = True


class PromptResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    project_id: str
    document_id: str | None
    figure_number: int
    title: str | None
    original_prompt: str | None
    edited_prompt: str | None
    active_prompt: str | None
    suggested_figure_type: str | None
    suggested_aspect_ratio: str | None
    source_sections: dict | list | None
    claude_model: str | None
    generation_status: str
    created_at: datetime
    updated_at: datetime | None


class PromptUpdate(BaseModel):
    edited_prompt: str


class PromptStatusResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    generation_status: str
