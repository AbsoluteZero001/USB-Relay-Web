from typing import Annotated

from fastapi import APIRouter, Depends

from app.api.dependencies import get_serial_service
from app.models.serial import SerialPortInfo
from app.services.serial_service import SerialService

router = APIRouter(prefix="/serial", tags=["serial"])


@router.get(
    "/ports",
    response_model=list[SerialPortInfo],
    summary="列出本机串口",
)
def list_serial_ports(
    serial_service: Annotated[SerialService, Depends(get_serial_service)],
) -> list[SerialPortInfo]:
    return serial_service.list_ports()
