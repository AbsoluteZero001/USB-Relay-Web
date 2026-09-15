from typing import Annotated

from fastapi import APIRouter, Depends, Query

from app.api.dependencies import get_audit_log_service
from app.models.audit import AuditLogPage, ClearAuditLogsResponse
from app.services.audit_log_service import AuditLogService

router = APIRouter(prefix="/logs", tags=["logs"])


@router.get(
    "",
    response_model=AuditLogPage,
    summary="读取最近操作日志",
)
def list_logs(
    audit_log_service: Annotated[
        AuditLogService,
        Depends(get_audit_log_service),
    ],
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> AuditLogPage:
    return audit_log_service.list_entries(limit=limit, offset=offset)


@router.delete(
    "",
    response_model=ClearAuditLogsResponse,
    summary="清空内存操作日志",
)
def clear_logs(
    audit_log_service: Annotated[
        AuditLogService,
        Depends(get_audit_log_service),
    ],
) -> ClearAuditLogsResponse:
    return ClearAuditLogsResponse(deleted=audit_log_service.clear())
