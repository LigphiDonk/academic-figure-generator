"""Custom application exceptions and FastAPI exception handlers."""

import traceback

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from app.config import get_settings


class AppException(Exception):
    """Base application exception."""

    def __init__(
        self,
        status_code: int,
        detail: str,
        error_code: str = "APP_ERROR",
    ) -> None:
        self.status_code = status_code
        self.detail = detail
        self.error_code = error_code
        super().__init__(detail)


class NotFoundException(AppException):
    def __init__(self, detail: str = "Resource not found") -> None:
        super().__init__(status_code=404, detail=detail, error_code="NOT_FOUND")


class UnauthorizedException(AppException):
    def __init__(self, detail: str = "Authentication required") -> None:
        super().__init__(status_code=401, detail=detail, error_code="UNAUTHORIZED")


class ForbiddenException(AppException):
    def __init__(self, detail: str = "Access forbidden") -> None:
        super().__init__(status_code=403, detail=detail, error_code="FORBIDDEN")


class BadRequestException(AppException):
    def __init__(self, detail: str = "Bad request") -> None:
        super().__init__(status_code=400, detail=detail, error_code="BAD_REQUEST")


class InsufficientBalanceException(AppException):
    def __init__(self, detail: str = "Insufficient balance") -> None:
        super().__init__(status_code=400, detail=detail, error_code="INSUFFICIENT_BALANCE")


class RateLimitException(AppException):
    def __init__(self, detail: str = "Rate limit exceeded") -> None:
        super().__init__(status_code=429, detail=detail, error_code="RATE_LIMIT_EXCEEDED")


class FileValidationException(AppException):
    def __init__(self, detail: str = "File validation failed") -> None:
        super().__init__(status_code=422, detail=detail, error_code="FILE_VALIDATION_ERROR")


class ExternalAPIException(AppException):
    def __init__(self, service_name: str, detail: str = "External API error") -> None:
        self.service_name = service_name
        super().__init__(
            status_code=502,
            detail=f"[{service_name}] {detail}",
            error_code="EXTERNAL_API_ERROR",
        )


# ---------------------------------------------------------------------------
# FastAPI exception handlers
# ---------------------------------------------------------------------------


def _app_exception_handler(request: Request, exc: AppException) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "error": exc.error_code,
            "detail": exc.detail,
        },
    )


def register_exception_handlers(app: FastAPI) -> None:
    """Register all custom exception handlers on the FastAPI app."""
    app.add_exception_handler(AppException, _app_exception_handler)  # type: ignore[arg-type]

    # Catch-all for unhandled server errors in non-debug mode
    async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
        settings = get_settings()
        if settings.DEBUG:
            return JSONResponse(
                status_code=500,
                content={
                    "error": "INTERNAL_SERVER_ERROR",
                    "detail": f"{type(exc).__name__}: {exc}",
                    "traceback": traceback.format_exc(),
                },
            )
        return JSONResponse(
            status_code=500,
            content={
                "error": "INTERNAL_SERVER_ERROR",
                "detail": "An unexpected error occurred.",
            },
        )

    app.add_exception_handler(Exception, unhandled_exception_handler)  # type: ignore[arg-type]
