import pytest
import serial

from app.config import Settings
from app.services.exceptions import (
    PortBusyError,
    SerialAlreadyConnectedError,
    SerialNotConnectedError,
    SerialWriteError,
)
from app.services.serial_service import SerialService
from tests.fakes import (
    FakeSerialFactory,
    access_denied_error,
    fake_port_lister,
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
        "description": "USB-SERIAL CH340",
        "manufacturer": "wch.cn",
        "hwid": "USB VID:PID=1A86:7523 SER=TEST",
    }


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
