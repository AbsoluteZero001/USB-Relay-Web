from typing import Annotated

from fastapi import APIRouter, Depends

from app.api.dependencies import get_app_settings, get_serial_service
from app.config import Settings
from app.models.health import HealthResponse
from app.services.serial_service import SerialService

router = APIRouter(tags=["system"])


@router.get(
    "/health",
    response_model=HealthResponse,
    summary="后端健康检查",
)
def health_check(
    settings: Annotated[Settings, Depends(get_app_settings)],
    serial_service: Annotated[SerialService, Depends(get_serial_service)],
) -> HealthResponse:
    return HealthResponse(
        status="ok",
        service=settings.app_name,
        serial_connected=serial_service.get_status().connected,
    )
