import logging
import threading

from app.models.audit import AuditLogEntry, AuditResult
from app.models.relay import RelayActionResponse, RelayState, RelayStatus
from app.services.audit_log_service import AuditLogService
from app.services.exceptions import RelayStateUnknownError, ServiceError
from app.services.serial_service import SerialService

logger = logging.getLogger(__name__)

RELAY_ON_COMMAND = bytes.fromhex("A0 01 01 A2")
RELAY_OFF_COMMAND = bytes.fromhex("A0 01 00 A1")


class RelayService:
    """Implement LCUS-1 relay commands on top of SerialService."""

    def __init__(
        self,
        serial_service: SerialService,
        audit_log_service: AuditLogService | None = None,
    ) -> None:
        self._serial_service = serial_service
        self._audit_log_service = audit_log_service or AuditLogService()
        self._relay_state: RelayState = "unknown"
        self._lock = threading.RLock()

    def connect(self, port: str) -> RelayStatus:
        with self._lock:
            normalized_port = port.strip()
            current_port = self._serial_service.connected_port
            if current_port == normalized_port and current_port is not None:
                logger.info("串口 %s 已连接，重复连接请求直接返回", current_port)
                self._record_audit(
                    action="CONNECT",
                    command="SERIAL_CONNECT",
                    hex_value=None,
                    port=current_port,
                    result="success",
                    detail="串口已连接，重复请求已忽略",
                )
                return self.get_status()

            if current_port is not None:
                logger.info(
                    "正在从串口 %s 安全切换到 %s",
                    current_port,
                    normalized_port,
                )
                self._serial_service.disconnect()
                self._relay_state = "unknown"

            try:
                self._serial_service.connect(port)
            except ServiceError as exc:
                self._record_audit(
                    action="CONNECT",
                    command="SERIAL_CONNECT",
                    hex_value=None,
                    port=normalized_port,
                    result="failed",
                    detail=exc.message,
                    error_code=exc.code,
                )
                raise

            self._relay_state = "unknown"
            logger.info("继电器控制器已连接: %s", normalized_port)
            self._record_audit(
                action="CONNECT",
                command="SERIAL_CONNECT",
                hex_value=None,
                port=normalized_port,
                result="success",
                detail=f"串口 {normalized_port} 连接成功",
            )
            return self.get_status()

    def disconnect(self) -> RelayStatus:
        with self._lock:
            port = self._serial_service.disconnect()
            self._relay_state = "unknown"
            logger.info("继电器控制器已断开: %s", port or "未连接")
            self._record_audit(
                action="DISCONNECT",
                command="SERIAL_DISCONNECT",
                hex_value=None,
                port=port,
                result="success",
                detail=f"串口 {port or '当前设备'} 已断开",
            )
            return self.get_status()

    def on(self) -> RelayActionResponse:
        return self._execute(
            command=RELAY_ON_COMMAND,
            target_state="on",
            action_name="ON",
        )

    def off(self) -> RelayActionResponse:
        return self._execute(
            command=RELAY_OFF_COMMAND,
            target_state="off",
            action_name="OFF",
        )

    def toggle(self) -> RelayActionResponse:
        with self._lock:
            if self._relay_state == "on":
                return self.off()
            if self._relay_state == "off":
                return self.on()
            raise RelayStateUnknownError(
                "无法可靠判断当前继电器状态，请先发送 ON 或 OFF 指令"
            )

    def get_status(self) -> RelayStatus:
        with self._lock:
            connected = self._serial_service.is_connected()
            port = self._serial_service.connected_port if connected else None
            state = self._relay_state if connected else "unknown"
            source = (
                "software_last_command"
                if connected and state != "unknown"
                else "unknown"
            )
            return RelayStatus(
                connected=connected,
                port=port,
                relay_state=state,
                state_source=source,
            )

    def _execute(
        self,
        *,
        command: bytes,
        target_state: RelayState,
        action_name: str,
    ) -> RelayActionResponse:
        with self._lock:
            port = self._serial_service.connected_port
            try:
                self._serial_service.write(command)
                self._relay_state = target_state
            except ServiceError as exc:
                self._relay_state = "unknown"
                logger.exception("继电器%s指令发送失败", action_name)
                self._record_command_event(
                    action=action_name,
                    command=command,
                    port=port,
                    result="failed",
                    detail=exc.message,
                    error_code=exc.code,
                )
                raise

            command_text = command.hex(" ").upper()
            logger.info(
                "Relay 1 %s指令发送成功，TX %s",
                action_name,
                command_text,
            )
            self._record_command_event(
                action=action_name,
                command=command,
                port=port,
                result="success",
                detail=f"Relay 1 {action_name} 指令发送成功",
            )
            return RelayActionResponse(
                success=True,
                message=f"Relay 1 {action_name} 指令发送成功",
                command=command_text,
                status=self.get_status(),
            )

    def _record_command_event(
        self,
        *,
        action: str,
        command: bytes,
        port: str | None,
        result: AuditResult,
        detail: str,
        error_code: str | None = None,
    ) -> None:
        entry = self._record_audit(
            action=action,
            command=f"RELAY_{action}",
            hex_value=command.hex(" ").upper(),
            port=port,
            result=result,
            detail=detail,
            error_code=error_code,
        )
        logger.info("relay_command %s", entry.model_dump_json())

    def _record_audit(
        self,
        *,
        action: str,
        command: str | None,
        hex_value: str | None,
        port: str | None,
        result: AuditResult,
        detail: str,
        error_code: str | None = None,
    ) -> AuditLogEntry:
        return self._audit_log_service.add(
            action=action,
            command=command,
            hex_value=hex_value,
            port=port,
            result=result,
            detail=detail,
            error_code=error_code,
        )
