from typing import Literal

from pydantic import BaseModel, Field, field_validator

RelayState = Literal["on", "off", "unknown"]
RelayStateSource = Literal["software_last_command", "unknown"]


class RelayConnectRequest(BaseModel):
    port: str = Field(min_length=1, max_length=64, examples=["COM3"])

    @field_validator("port")
    @classmethod
    def normalize_port(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("串口名称不能为空")
        return normalized


class RelayStatus(BaseModel):
    connected: bool
    port: str | None = None
    relay_state: RelayState = "unknown"
    state_source: RelayStateSource = "unknown"


class RelayActionResponse(BaseModel):
    success: bool
    message: str
    command: str
    status: RelayStatus


class ApiError(BaseModel):
    detail: str
    code: str
