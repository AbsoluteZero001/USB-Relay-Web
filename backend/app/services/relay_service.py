import logging
import threading

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
            self._serial_service.connect(port)
            self._relay_state = "unknown"
            logger.info("继电器控制器已连接: %s", port)
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
            action_name="打开",
        )

    def off(self) -> RelayActionResponse:
        return self._execute(
            command=RELAY_OFF_COMMAND,
            target_state="off",
            action_name="关闭",
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
            try:
                self._serial_service.write(command)
                self._relay_state = target_state
            except ServiceError:
                self._relay_state = "unknown"
                logger.exception("继电器%s指令发送失败", action_name)
                raise

            command_text = command.hex(" ").upper()
            logger.info(
                "Relay 1 %s指令发送成功，TX %s",
                action_name,
                command_text,
            )
            return RelayActionResponse(
                success=True,
                message=f"Relay 1 已发送{action_name}指令",
                command=command_text,
                status=self.get_status(),
            )
