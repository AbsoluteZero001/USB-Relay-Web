from fastapi import Request

from app.config import Settings
from app.services.audit_log_service import AuditLogService
from app.services.relay_service import RelayService
from app.services.serial_service import SerialService


def get_serial_service(request: Request) -> SerialService:
    return request.app.state.serial_service


def get_relay_service(request: Request) -> RelayService:
    return request.app.state.relay_service


def get_audit_log_service(request: Request) -> AuditLogService:
    return request.app.state.audit_log_service


def get_app_settings(request: Request) -> Settings:
    return request.app.state.settings
