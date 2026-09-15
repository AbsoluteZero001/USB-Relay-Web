from fastapi import Request

from app.services.relay_service import RelayService
from app.services.serial_service import SerialService


def get_serial_service(request: Request) -> SerialService:
    return request.app.state.serial_service


def get_relay_service(request: Request) -> RelayService:
    return request.app.state.relay_service
