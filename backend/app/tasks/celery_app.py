"""
Celery application configuration for academic-figure-generator.

Two queues:
  - prompts: Prompt AI calls for prompt generation (CPU-light, IO-heavy)
  - images:  NanoBanana API calls for image generation (long-running, IO-heavy)

Run workers with:
  celery -A app.tasks.celery_app worker -l info -Q default,prompts,images -c 4
"""

from __future__ import annotations

import os

from celery import Celery

# ---------------------------------------------------------------------------
# Read configuration directly from environment variables.
# We do NOT import app.core.config here because Celery workers may start
# before the full FastAPI application context is available, and pydantic-settings
# loads .env files which may not be present in production (values come from
# Docker / k8s env injection instead).
# ---------------------------------------------------------------------------

CELERY_BROKER_URL: str = os.environ.get(
    "CELERY_BROKER_URL", "redis://localhost:6379/1"
)
CELERY_RESULT_BACKEND: str = os.environ.get(
    "CELERY_RESULT_BACKEND", "redis://localhost:6379/2"
)

# ---------------------------------------------------------------------------
# Celery application instance
# ---------------------------------------------------------------------------

celery_app = Celery(
    "academic_figure_generator",
    broker=CELERY_BROKER_URL,
    backend=CELERY_RESULT_BACKEND,
    include=[
        "app.tasks.prompt_tasks",
        "app.tasks.image_tasks",
        "app.tasks.ocr_tasks",
    ],
)

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

celery_app.conf.update(
    # Serialization
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    # Timezone
    timezone="UTC",
    enable_utc=True,
    # Reliability
    task_track_started=True,
    task_acks_late=True,           # Ack only after task completes (safer against crashes)
    worker_prefetch_multiplier=1,  # One task at a time per worker slot (pairs with acks_late)
    # Result expiry: keep results for 24 hours then evict from Redis
    result_expires=86400,
    # Routing
    task_routes={
        "app.tasks.ocr_tasks.*": {"queue": "default"},
        "app.tasks.prompt_tasks.*": {"queue": "prompts"},
        "app.tasks.image_tasks.*": {"queue": "images"},
    },
    task_default_queue="default",
    task_queues={
        # Explicitly declare queues so beat/workers can reference them by name
        "default": {},
        "prompts": {},
        "images": {},
    },
    # Beat schedule placeholder (add periodic tasks here as needed)
    beat_schedule={},
)

__all__ = ["celery_app"]
