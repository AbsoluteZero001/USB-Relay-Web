import json
import logging
import threading
from datetime import datetime, timezone

from app.models.relay import RelayActionResponse, RelayState, RelayStatus
from app.services.exceptions import RelayStateUnknownError, ServiceError
from app.services.serial_service import SerialService

logger = logging.getLogger(__name__)

RELAY_ON_COMMAND = bytes.fromhex("A0 01 01 A2")
RELAY_OFF_COMMAND = bytes.fromhex("A0 01 00 A1")


class RelayService:
    """Implement LCUS-1 relay commands on top of SerialService."""

    def __init__(self, serial_service: SerialService) -> None:
        self._serial_service = serial_service
        self._relay_state: RelayState = "unknown"
        self._lock = threading.RLock()

    def connect(self, port: str) -> RelayStatus:
        with self._lock:
            normalized_port = port.strip()
            current_port = self._serial_service.connected_port
            if current_port == normalized_port and current_port is not None:
                logger.info("串口 %s 已连接，重复连接请求直接返回", current_port)
                return self.get_status()

            if current_port is not None:
                logger.info(
                    "正在从串口 %s 安全切换到 %s",
                    current_port,
                    normalized_port,
                )
                self._serial_service.disconnect()
                self._relay_state = "unknown"

            self._serial_service.connect(port)
            self._relay_state = "unknown"
            logger.info("继电器控制器已连接: %s", normalized_port)
            return self.get_status()

    def disconnect(self) -> RelayStatus:
        with self._lock:
            port = self._serial_service.disconnect()
            self._relay_state = "unknown"
            logger.info("继电器控制器已断开: %s", port or "未连接")
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
                _log_command_event(
                    action=action_name,
                    command=command,
                    port=port,
                    success=False,
                    error_code=exc.code,
                )
                raise

            command_text = command.hex(" ").upper()
            logger.info(
                "Relay 1 %s指令发送成功，TX %s",
                action_name,
                command_text,
            )
            _log_command_event(
                action=action_name,
                command=command,
                port=port,
                success=True,
            )
            return RelayActionResponse(
                success=True,
                message=f"Relay 1 {action_name} 指令发送成功",
                command=command_text,
                status=self.get_status(),
            )


def _log_command_event(
    *,
    action: str,
    command: bytes,
    port: str | None,
    success: bool,
    error_code: str | None = None,
) -> None:
    payload: dict[str, object] = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "event": "relay_command",
        "action": action,
        "command": f"RELAY_{action}",
        "command_hex": command.hex(" ").upper(),
        "port": port,
        "result": "success" if success else "failed",
        "success": success,
    }
    if error_code is not None:
        payload["error_code"] = error_code
    logger.info(
        "relay_command %s",
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
    )
