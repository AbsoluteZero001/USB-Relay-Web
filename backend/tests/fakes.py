from __future__ import annotations

import threading
import time

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
        write_delay: float = 0.0,
    ) -> None:
        self.port = port
        self.baudrate = baudrate
        self.bytesize = bytesize
        self.parity = parity
        self.stopbits = stopbits
        self.timeout = timeout
        self.write_timeout = write_timeout
        self.write_delay = write_delay
        self.is_open = True
        self.writes: list[bytes] = []
        self.flush_count = 0
        self.closed = False
        self.concurrent_write_detected = False
        self._write_error = write_error
        self._write_active = False
        self._state_lock = threading.Lock()

    def open(self) -> None:
        self.is_open = True

    def close(self) -> None:
        self.is_open = False
        self.closed = True

    def write(self, data: bytes) -> int:
        with self._state_lock:
            if self._write_active:
                self.concurrent_write_detected = True
            self._write_active = True

        try:
            if self.write_delay:
                time.sleep(self.write_delay)
            if self._write_error is not None:
                raise self._write_error
            self.writes.append(data)
            return len(data)
        finally:
            with self._state_lock:
                self._write_active = False

    def flush(self) -> None:
        self.flush_count += 1

    def unplug(self) -> None:
        self.is_open = False


class FakeSerialFactory:
    def __init__(
        self,
        *,
        open_error: Exception | None = None,
        write_error: Exception | None = None,
        initially_closed: bool = False,
        write_delay: float = 0.0,
    ) -> None:
        self.open_error = open_error
        self.write_error = write_error
        self.initially_closed = initially_closed
        self.write_delay = write_delay
        self.instances: list[FakeSerial] = []

    def __call__(
        self,
        *,
        port: str,
        baudrate: int,
        bytesize: int,
        parity: str,
        stopbits: int,
        timeout: float,
        write_timeout: float,
    ) -> FakeSerial:
        if self.open_error is not None:
            raise self.open_error

        instance = FakeSerial(
            port=port,
            baudrate=baudrate,
            bytesize=bytesize,
            parity=parity,
            stopbits=stopbits,
            timeout=timeout,
            write_timeout=write_timeout,
            write_error=self.write_error,
            write_delay=self.write_delay,
        )
        instance.is_open = not self.initially_closed
        self.instances.append(instance)
        return instance


class BlockingSerialFactory:
    def __init__(self, delegate: FakeSerialFactory) -> None:
        self.delegate = delegate
        self.connect_started = threading.Event()
        self.release_connect = threading.Event()

    def __call__(
        self,
        *,
        port: str,
        baudrate: int,
        bytesize: int,
        parity: str,
        stopbits: int,
        timeout: float,
        write_timeout: float,
    ) -> FakeSerial:
        self.connect_started.set()
        if not self.release_connect.wait(timeout=2):
            raise TimeoutError("test did not release serial connection")
        return self.delegate(
            port=port,
            baudrate=baudrate,
            bytesize=bytesize,
            parity=parity,
            stopbits=stopbits,
            timeout=timeout,
            write_timeout=write_timeout,
        )


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


def port_not_found_error() -> serial.SerialException:
    return serial.SerialException(
        "could not open port 'COM404': FileNotFoundError"
    )
