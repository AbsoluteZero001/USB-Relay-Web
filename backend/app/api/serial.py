from typing import Annotated

from fastapi import APIRouter, Depends

from app.api.dependencies import get_serial_service
from app.models.serial import SerialPortInfo, SerialStatus
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


@router.get(
    "/status",
    response_model=SerialStatus,
    summary="读取串口生命周期状态",
)
def get_serial_status(
    serial_service: Annotated[SerialService, Depends(get_serial_service)],
) -> SerialStatus:
    return serial_service.get_status()
