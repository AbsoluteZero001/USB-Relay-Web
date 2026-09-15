from typing import Literal

from pydantic import BaseModel

SerialConnectionState = Literal[
    "disconnected",
    "connecting",
    "connected",
    "error",
]


class SerialPortInfo(BaseModel):
    port: str
    device: str
    description: str
    manufacturer: str | None = None
    hwid: str | None = None
    is_current: bool = False


class SerialStatus(BaseModel):
    state: SerialConnectionState
    port: str | None = None
    device: str | None = None
    baudrate: int
    connected: bool
    error_code: str | None = None
    detail: str | None = None
