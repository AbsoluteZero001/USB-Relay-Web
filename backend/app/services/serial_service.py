import logging
import threading
from collections.abc import Callable, Iterable
from typing import Protocol

import serial
from serial.tools import list_ports

from app.config import Settings, get_settings
from app.models.serial import SerialConnectionState, SerialPortInfo, SerialStatus
from app.services.exceptions import (
    PortBusyError,
    PortNotFoundError,
    SerialAlreadyConnectedError,
    SerialConnectionError,
    SerialNotConnectedError,
    SerialPortScanError,
    SerialWriteError,
    ServiceError,
)

logger = logging.getLogger(__name__)


class SerialConnection(Protocol):
    @property
    def is_open(self) -> bool: ...

    def open(self) -> None: ...

    def close(self) -> None: ...

    def write(self, data: bytes) -> int | None: ...

    def flush(self) -> None: ...


SerialFactory = Callable[..., SerialConnection]
PortLister = Callable[[], Iterable[object]]


class SerialService:
    """Own the serial connection lifecycle and serialize all writes."""

    def __init__(
        self,
        settings: Settings | None = None,
        *,
        serial_factory: SerialFactory | None = None,
        port_lister: PortLister | None = None,
    ) -> None:
        self._settings = settings or get_settings()
        self._serial_factory = serial_factory or serial.Serial
        self._port_lister = port_lister or list_ports.comports
        self._serial: SerialConnection | None = None
        self._connected_port: str | None = None
        self._device_name: str | None = None
        self._state: SerialConnectionState = "disconnected"
        self._error_code: str | None = None
        self._error_detail: str | None = None
        self._lock = threading.RLock()

    def list_ports(self) -> list[SerialPortInfo]:
        current_port = self.connected_port
        try:
            discovered = self._port_lister()
            ports = []
            for item in discovered:
                port = str(getattr(item, "device"))
                ports.append(
                    SerialPortInfo(
                        port=port,
                        device=port,
                        description=str(
                            getattr(item, "description", "") or ""
                        ),
                        manufacturer=_optional_string(item, "manufacturer"),
                        hwid=_optional_string(item, "hwid"),
                        is_current=port == current_port,
                    )
                )
        except Exception as exc:
            logger.exception("串口扫描失败")
            raise SerialPortScanError(
                "串口扫描失败，请检查 Windows 串口服务后重试"
            ) from exc

        ports.sort(key=lambda item: item.port)
        logger.info(
            "串口扫描完成，发现 %d 个端口: %s",
            len(ports),
            ", ".join(item.port for item in ports) or "无",
        )
        return ports

    def connect(self, port: str) -> None:
        normalized_port = port.strip()
        if not normalized_port:
            raise PortNotFoundError("串口名称不能为空")

        with self._lock:
            if self.is_connected():
                raise SerialAlreadyConnectedError(
                    f"串口 {self._connected_port} 已连接，请先断开"
                )

            self._state = "connecting"
            self._connected_port = normalized_port
            self._device_name = normalized_port
            self._error_code = None
            self._error_detail = None

            connection: SerialConnection | None = None
            try:
                connection = self._serial_factory(
                    port=normalized_port,
                    baudrate=self._settings.serial_baudrate,
                    bytesize=serial.EIGHTBITS,
                    parity=serial.PARITY_NONE,
                    stopbits=serial.STOPBITS_ONE,
                    timeout=self._settings.serial_timeout,
                    write_timeout=self._settings.serial_write_timeout,
                )
                if not connection.is_open:
                    connection.open()
            except (serial.SerialException, OSError) as exc:
                _close_after_failed_connect(connection)
                mapped_error = _map_connection_error(normalized_port, exc)
                self._set_error(mapped_error.code, mapped_error.message)
                logger.warning(
                    "串口连接失败: %s, error=%s",
                    normalized_port,
                    exc,
                )
                raise mapped_error from exc
            except Exception as exc:
                _close_after_failed_connect(connection)
                logger.exception("连接串口 %s 时发生未知异常", normalized_port)
                mapped_error = SerialConnectionError(
                    f"连接串口 {normalized_port} 失败，"
                    "请检查 CH340 驱动和设备状态"
                )
                self._set_error(mapped_error.code, mapped_error.message)
                raise mapped_error from exc

            self._serial = connection
            self._state = "connected"
            self._error_code = None
            self._error_detail = None
            self._device_name = self._resolve_device_name(normalized_port)
            logger.info(
                "串口连接成功: %s, %d / 8N1",
                normalized_port,
                self._settings.serial_baudrate,
            )

    def disconnect(self) -> str | None:
        with self._lock:
            connection = self._serial
            port = self._connected_port
            self._serial = None
            self._connected_port = None

            if connection is not None:
                try:
                    connection.close()
                except Exception:
                    logger.exception("关闭串口 %s 时发生异常", port)
                    self._state = "error"
                    self._connected_port = port
                    self._error_code = "SERIAL_CLOSE_FAILED"
                    self._error_detail = "串口关闭失败，请重试或重新启动后端"
                    return port
                else:
                    logger.info("串口已断开: %s", port)

            self._state = "disconnected"
            self._connected_port = None
            self._device_name = None
            self._error_code = None
            self._error_detail = None
            return port

    def is_connected(self) -> bool:
        with self._lock:
            if self._serial is None:
                return False

            try:
                connected = bool(self._serial.is_open)
            except Exception as exc:
                logger.exception("读取串口状态失败，已清理连接")
                self._close_current_connection(
                    error_code="SERIAL_STATUS_READ_FAILED",
                    detail="读取串口状态失败，连接已失效",
                    cause=exc,
                )
                return False

            if not connected:
                self._close_current_connection(
                    error_code="SERIAL_DEVICE_DISCONNECTED",
                    detail="USB 串口设备已断开",
                )
                return False

            self._state = "connected"
            return connected

    @property
    def connected_port(self) -> str | None:
        with self._lock:
            return self._connected_port if self.is_connected() else None

    def get_status(self) -> SerialStatus:
        if self._state == "connecting":
            return SerialStatus(
                state="connecting",
                port=self._connected_port,
                device=self._device_name or self._connected_port,
                baudrate=self._settings.serial_baudrate,
                connected=False,
                error_code=None,
                detail=None,
            )

        with self._lock:
            connected = self.is_connected()
            return SerialStatus(
                state=self._state,
                port=self._connected_port,
                device=self._device_name or self._connected_port,
                baudrate=self._settings.serial_baudrate,
                connected=connected,
                error_code=self._error_code,
                detail=self._error_detail,
            )

    def write(self, data: bytes) -> None:
        if not isinstance(data, bytes):
            raise TypeError("SerialService.write 只接受 bytes")

        with self._lock:
            if not self.is_connected() or self._serial is None:
                raise SerialNotConnectedError("串口尚未连接")

            try:
                written = self._serial.write(data)
                if written is not None and written != len(data):
                    raise serial.SerialTimeoutException(
                        f"仅写入 {written}/{len(data)} 字节"
                    )
                self._serial.flush()
            except (serial.SerialException, OSError) as exc:
                port = self._connected_port
                logger.exception(
                    "串口写入失败: %s, TX %s",
                    port,
                    data.hex(" ").upper(),
                )
                detail = (
                    f"串口 {port or '当前设备'} 写入失败，"
                    "设备可能已拔出，请重新连接"
                )
                self._close_current_connection(
                    error_code="SERIAL_WRITE_FAILED",
                    detail=detail,
                    cause=exc,
                )
                raise SerialWriteError(detail) from exc
            except Exception as exc:
                port = self._connected_port
                logger.exception(
                    "串口写入发生未知异常: %s, TX %s",
                    port,
                    data.hex(" ").upper(),
                )
                detail = f"串口 {port or '当前设备'} 写入失败，请重新连接"
                self._close_current_connection(
                    error_code="SERIAL_WRITE_FAILED",
                    detail=detail,
                    cause=exc,
                )
                raise SerialWriteError(detail) from exc

            logger.info("TX %s", data.hex(" ").upper())

    def _set_error(self, code: str, detail: str) -> None:
        self._state = "error"
        self._error_code = code
        self._error_detail = detail

    def _close_current_connection(
        self,
        *,
        error_code: str,
        detail: str,
        cause: Exception | None = None,
    ) -> None:
        connection = self._serial
        self._serial = None
        self._state = "error"
        self._error_code = error_code
        self._error_detail = detail
        if connection is not None:
            try:
                connection.close()
            except Exception:
                logger.exception(
                    "清理失效串口连接时关闭失败",
                    exc_info=cause,
                )

    def _resolve_device_name(self, port: str) -> str:
        try:
            for item in self._port_lister():
                if str(getattr(item, "device")) == port:
                    description = str(
                        getattr(item, "description", "") or ""
                    ).strip()
                    if description:
                        return description
        except Exception:
            logger.warning("读取串口 %s 的设备描述失败", port, exc_info=True)
        return port


def _optional_string(item: object, attribute: str) -> str | None:
    value = getattr(item, attribute, None)
    return str(value) if value else None


def _close_after_failed_connect(connection: SerialConnection | None) -> None:
    if connection is None:
        return
    try:
        connection.close()
    except Exception:
        logger.exception("清理连接失败的串口对象时发生异常")


def _map_connection_error(port: str, exc: Exception) -> ServiceError:
    message = str(exc).lower()
    if any(
        token in message
        for token in (
            "access is denied",
            "permission",
            "busy",
            "拒绝访问",
            "占用",
        )
    ):
        return PortBusyError(
            f"串口 {port} 正在被其他程序占用，"
            "请关闭 SSCOM 等串口软件后重试"
        )
    if any(
        token in message
        for token in (
            "could not open port",
            "file not found",
            "cannot find",
            "找不到",
        )
    ):
        return PortNotFoundError(
            f"串口 {port} 不存在，请检查设备连接后刷新串口列表"
        )
    return SerialConnectionError(
        f"连接串口 {port} 失败，请检查 CH340 驱动和设备状态"
    )
