from __future__ import annotations

import serial


class FakePortInfo:
    def __init__(
        self,
        device: str,
        description: str = "",
        manufacturer: str | None = None,
        hwid: str | None = None,
    ) -> None:
        self.device = device
        self.description = description
        self.manufacturer = manufacturer
        self.hwid = hwid


class FakeSerial:
    def __init__(
        self,
        *,
        port: str,
        baudrate: int,
        bytesize: int,
        parity: str,
        stopbits: int,
        timeout: float,
        write_timeout: float,
        write_error: Exception | None = None,
    ) -> None:
        self.port = port
        self.baudrate = baudrate
        self.bytesize = bytesize
        self.parity = parity
        self.stopbits = stopbits
        self.timeout = timeout
        self.write_timeout = write_timeout
        self.is_open = True
        self.writes: list[bytes] = []
        self.flush_count = 0
        self.closed = False
        self._write_error = write_error

    def open(self) -> None:
        self.is_open = True

    def close(self) -> None:
        self.is_open = False
        self.closed = True

    def write(self, data: bytes) -> int:
        if self._write_error is not None:
            raise self._write_error
        self.writes.append(data)
        return len(data)

    def flush(self) -> None:
        self.flush_count += 1


class FakeSerialFactory:
    def __init__(
        self,
        *,
        open_error: Exception | None = None,
        write_error: Exception | None = None,
        initially_closed: bool = False,
    ) -> None:
        self.open_error = open_error
        self.write_error = write_error
        self.initially_closed = initially_closed
        self.instances: list[FakeSerial] = []

    def __call__(self, **kwargs: object) -> FakeSerial:
        if self.open_error is not None:
            raise self.open_error

        instance = FakeSerial(
            port=str(kwargs["port"]),
            baudrate=int(kwargs["baudrate"]),
            bytesize=int(kwargs["bytesize"]),
            parity=str(kwargs["parity"]),
            stopbits=int(kwargs["stopbits"]),
            timeout=float(kwargs["timeout"]),
            write_timeout=float(kwargs["write_timeout"]),
            write_error=self.write_error,
        )
        instance.is_open = not self.initially_closed
        self.instances.append(instance)
        return instance


def fake_port_lister() -> list[FakePortInfo]:
    return [
        FakePortInfo(
            device="COM3",
            description="USB-SERIAL CH340",
            manufacturer="wch.cn",
            hwid="USB VID:PID=1A86:7523 SER=TEST",
        )
    ]


def access_denied_error() -> serial.SerialException:
    return serial.SerialException("Access is denied")
