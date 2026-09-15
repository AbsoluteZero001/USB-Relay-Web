import pytest
import serial

from app.config import Settings
from app.services.exceptions import RelayStateUnknownError, SerialWriteError
from app.services.relay_service import (
    RELAY_OFF_COMMAND,
    RELAY_ON_COMMAND,
    RelayService,
)
from app.services.serial_service import SerialService
from tests.fakes import FakeSerialFactory, fake_port_lister


def make_relay_service(
    factory: FakeSerialFactory,
) -> tuple[RelayService, FakeSerialFactory]:
    serial_service = SerialService(
        Settings(),
        serial_factory=factory,
        port_lister=fake_port_lister,
    )
    return RelayService(serial_service), factory


def test_on_and_off_send_only_verified_commands() -> None:
    relay, factory = make_relay_service(FakeSerialFactory())
    relay.connect("COM3")

    on_result = relay.on()

    assert on_result.command == "A0 01 01 A2"
    assert on_result.status.relay_state == "on"
    assert on_result.status.state_source == "software_last_command"
    assert factory.instances[0].writes[-1] == RELAY_ON_COMMAND

    off_result = relay.off()

    assert off_result.command == "A0 01 00 A1"
    assert off_result.status.relay_state == "off"
    assert factory.instances[0].writes[-1] == RELAY_OFF_COMMAND


def test_toggle_requires_a_reliable_software_state() -> None:
    relay, factory = make_relay_service(FakeSerialFactory())
    relay.connect("COM3")

    with pytest.raises(RelayStateUnknownError):
        relay.toggle()

    relay.on()
    relay.toggle()

    assert factory.instances[0].writes[-1] == RELAY_OFF_COMMAND
    assert relay.get_status().relay_state == "off"


def test_disconnect_changes_reported_state_to_unknown() -> None:
    relay, _ = make_relay_service(FakeSerialFactory())
    relay.connect("COM3")
    relay.on()

    status = relay.disconnect()

    assert status.connected is False
    assert status.port is None
    assert status.relay_state == "unknown"
    assert status.state_source == "unknown"


def test_write_failure_marks_relay_state_unknown() -> None:
    relay, _ = make_relay_service(
        FakeSerialFactory(write_error=serial.SerialException("unplugged"))
    )
    relay.connect("COM3")

    with pytest.raises(SerialWriteError):
        relay.on()

    status = relay.get_status()
    assert status.connected is False
    assert status.relay_state == "unknown"
