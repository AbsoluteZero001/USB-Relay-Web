import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api import health, logs, relay, serial
from app.config import Settings, get_settings
from app.models.relay import ApiError
from app.services.audit_log_service import AuditLogService
from app.services.exceptions import ServiceError
from app.services.relay_service import RelayService
from app.services.serial_service import SerialService

logger = logging.getLogger(__name__)


def create_app(
    settings: Settings | None = None,
    *,
    serial_service: SerialService | None = None,
    audit_log_service: AuditLogService | None = None,
) -> FastAPI:
    app_settings = settings or get_settings()
    logging.basicConfig(
        level=logging.DEBUG if app_settings.debug else logging.INFO,
        format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
    )

    serial_service = serial_service or SerialService(app_settings)
    audit_log_service = audit_log_service or AuditLogService()
    relay_service = RelayService(serial_service, audit_log_service)

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        logger.info(
            "%s 后端启动，API 前缀: %s",
            app_settings.app_name,
            app_settings.api_prefix,
        )
        try:
            yield
        finally:
            serial_service.disconnect()
            logger.info("%s 后端已停止", app_settings.app_name)

    app = FastAPI(
        title=app_settings.app_name,
        description="Windows 本机 LCUS-1 USB 继电器控制 API",
        version="0.3.0",
        docs_url="/docs",
        redoc_url="/redoc",
        lifespan=lifespan,
    )
    app.state.settings = app_settings
    app.state.serial_service = serial_service
    app.state.relay_service = relay_service
    app.state.audit_log_service = audit_log_service

    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(app_settings.cors_origins),
        allow_credentials=False,
        allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
        allow_headers=["Content-Type"],
    )

    app.include_router(serial.router, prefix=app_settings.api_prefix)
    app.include_router(relay.router, prefix=app_settings.api_prefix)
    app.include_router(logs.router, prefix=app_settings.api_prefix)
    app.include_router(health.router, prefix=app_settings.api_prefix)

    @app.exception_handler(ServiceError)
    async def service_error_handler(
        _: Request,
        exc: ServiceError,
    ) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status_code,
            content=ApiError(detail=exc.message, code=exc.code).model_dump(),
        )

    @app.exception_handler(Exception)
    async def unhandled_error_handler(
        request: Request,
        exc: Exception,
    ) -> JSONResponse:
        logger.exception(
            "未处理异常: %s %s",
            request.method,
            request.url.path,
        )
        return JSONResponse(
            status_code=500,
            content=ApiError(
                detail="后端发生内部错误，请查看服务日志",
                code="INTERNAL_SERVER_ERROR",
            ).model_dump(),
        )

    @app.get("/", include_in_schema=False)
    def root() -> dict[str, str]:
        return {
            "name": app_settings.app_name,
            "docs": "/docs",
            "api": app_settings.api_prefix,
        }

    return app


app = create_app()
