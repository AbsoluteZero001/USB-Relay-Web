from typing import Annotated

from fastapi import APIRouter, Depends

from app.api.dependencies import get_relay_service
from app.models.relay import (
    ApiError,
    RelayActionResponse,
    RelayConnectRequest,
    RelayStatus,
)
from app.services.relay_service import RelayService

router = APIRouter(prefix="/relay", tags=["relay"])

ERROR_RESPONSES = {
    404: {"model": ApiError, "description": "串口不存在"},
    409: {"model": ApiError, "description": "连接冲突或串口未连接"},
    502: {"model": ApiError, "description": "串口通信失败"},
}


@router.post(
    "/connect",
    response_model=RelayStatus,
    responses=ERROR_RESPONSES,
    summary="连接继电器串口",
)
def connect_relay(
    payload: RelayConnectRequest,
    relay_service: Annotated[RelayService, Depends(get_relay_service)],
) -> RelayStatus:
    return relay_service.connect(payload.port)


@router.post(
    "/disconnect",
    response_model=RelayStatus,
    summary="断开继电器串口",
)
def disconnect_relay(
    relay_service: Annotated[RelayService, Depends(get_relay_service)],
) -> RelayStatus:
    return relay_service.disconnect()


@router.post(
    "/on",
    response_model=RelayActionResponse,
    responses=ERROR_RESPONSES,
    summary="打开 Relay 1",
)
def turn_relay_on(
    relay_service: Annotated[RelayService, Depends(get_relay_service)],
) -> RelayActionResponse:
    return relay_service.on()


@router.post(
    "/off",
    response_model=RelayActionResponse,
    responses=ERROR_RESPONSES,
    summary="关闭 Relay 1",
)
def turn_relay_off(
    relay_service: Annotated[RelayService, Depends(get_relay_service)],
) -> RelayActionResponse:
    return relay_service.off()


@router.get(
    "/status",
    response_model=RelayStatus,
    summary="读取继电器连接和软件状态",
)
def get_relay_status(
    relay_service: Annotated[RelayService, Depends(get_relay_service)],
) -> RelayStatus:
    return relay_service.get_status()
