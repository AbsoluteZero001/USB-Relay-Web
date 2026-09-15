from concurrent.futures import ThreadPoolExecutor

import pytest
import serial

from app.config import Settings
from app.services.exceptions import (
    PortBusyError,
    PortNotFoundError,
    SerialAlreadyConnectedError,
    SerialNotConnectedError,
    SerialPortScanError,
    SerialWriteError,
)
from app.services.serial_service import SerialService
from tests.fakes import (
    FakeSerialFactory,
    access_denied_error,
    fake_port_lister,
    port_not_found_error,
)


def make_serial_service(factory: FakeSerialFactory) -> SerialService:
    return SerialService(
        Settings(),
        serial_factory=factory,
        port_lister=fake_port_lister,
    )


def test_list_ports_maps_pyserial_fields() -> None:
    service = make_serial_service(FakeSerialFactory())

    ports = service.list_ports()

    assert len(ports) == 1
    assert ports[0].model_dump() == {
        "port": "COM3",
        "device": "COM3",
        "description": "USB-SERIAL CH340",
        "manufacturer": "wch.cn",
        "hwid": "USB VID:PID=1A86:7523 SER=TEST",
        "is_current": False,
    }


def test_list_ports_marks_current_connection() -> None:
    service = make_serial_service(FakeSerialFactory())
    service.connect("COM3")

    ports = service.list_ports()

    assert ports[0].is_current is True


def test_connect_uses_verified_serial_parameters_and_supports_disconnect() -> None:
    factory = FakeSerialFactory(initially_closed=True)
    service = make_serial_service(factory)

    service.connect(" COM3 ")

    assert service.is_connected()
    assert service.connected_port == "COM3"
    connection = factory.instances[0]
    assert connection.port == "COM3"
    assert connection.baudrate == 9600
    assert connection.bytesize == serial.EIGHTBITS
    assert connection.parity == serial.PARITY_NONE
    assert connection.stopbits == serial.STOPBITS_ONE

    assert service.disconnect() == "COM3"
    assert connection.closed
    assert not service.is_connected()


def test_duplicate_connect_is_rejected_without_opening_second_port() -> None:
    factory = FakeSerialFactory()
    service = make_serial_service(factory)
    service.connect("COM3")

    with pytest.raises(SerialAlreadyConnectedError):
        service.connect("COM3")

    assert len(factory.instances) == 1


def test_write_is_flushed_and_requires_connection() -> None:
    factory = FakeSerialFactory()
    service = make_serial_service(factory)

    with pytest.raises(SerialNotConnectedError):
        service.write(bytes.fromhex("A0 01 01 A2"))

    service.connect("COM3")
    service.write(bytes.fromhex("A0 01 01 A2"))

    connection = factory.instances[0]
    assert connection.writes == [bytes.fromhex("A0 01 01 A2")]
    assert connection.flush_count == 1


def test_write_failure_clears_broken_connection() -> None:
    factory = FakeSerialFactory(
        write_error=serial.SerialException("device disconnected")
    )
    service = make_serial_service(factory)
    service.connect("COM3")

    with pytest.raises(SerialWriteError):
        service.write(bytes.fromhex("A0 01 00 A1"))

    assert not service.is_connected()
    assert factory.instances[0].closed


def test_access_denied_is_mapped_to_busy_port_error() -> None:
    factory = FakeSerialFactory(open_error=access_denied_error())
    service = make_serial_service(factory)

    with pytest.raises(PortBusyError):
        service.connect("COM3")


def test_missing_port_is_mapped_to_not_found_error() -> None:
    factory = FakeSerialFactory(open_error=port_not_found_error())
    service = make_serial_service(factory)

    with pytest.raises(PortNotFoundError):
        service.connect("COM404")


def test_unplugged_device_is_cleared_before_next_write() -> None:
    factory = FakeSerialFactory()
    service = make_serial_service(factory)
    service.connect("COM3")

    factory.instances[0].unplug()

    assert not service.is_connected()
    with pytest.raises(SerialNotConnectedError):
        service.write(bytes.fromhex("A0 01 01 A2"))


def test_concurrent_writes_are_serialized() -> None:
    factory = FakeSerialFactory(write_delay=0.002)
    service = make_serial_service(factory)
    service.connect("COM3")
    commands = [bytes([value]) * 4 for value in range(1, 17)]

    with ThreadPoolExecutor(max_workers=8) as executor:
        list(executor.map(service.write, commands))

    connection = factory.instances[0]
    assert connection.concurrent_write_detected is False
    assert len(connection.writes) == len(commands)
    assert sorted(connection.writes) == sorted(commands)


def test_port_scan_failure_returns_stable_service_error() -> None:
    def failing_port_lister() -> list[object]:
        raise OSError("system serial service unavailable")

    service = SerialService(
        Settings(),
        serial_factory=FakeSerialFactory(),
        port_lister=failing_port_lister,
    )

    with pytest.raises(SerialPortScanError) as exc_info:
        service.list_ports()

    assert str(exc_info.value) == "串口扫描失败，请检查 Windows 串口服务后重试"
