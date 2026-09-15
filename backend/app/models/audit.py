from datetime import datetime
from typing import Literal

from pydantic import BaseModel

AuditResult = Literal["success", "failed"]


class AuditLogEntry(BaseModel):
    timestamp: datetime
    action: str
    command: str | None = None
    hex: str | None = None
    port: str | None = None
    result: AuditResult
    error_code: str | None = None
    detail: str


class AuditLogPage(BaseModel):
    items: list[AuditLogEntry]
    total: int
    limit: int
    offset: int


class ClearAuditLogsResponse(BaseModel):
    deleted: int
