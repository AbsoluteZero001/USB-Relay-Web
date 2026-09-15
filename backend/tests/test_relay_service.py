import json
import logging

import pytest
import serial

from app.config import Settings
from app.services.exceptions import (
    RelayStateUnknownError,
    SerialNotConnectedError,
    SerialWriteError,
)
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
    assert off_result.status.state_source == "software_last_command"
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


def test_reconnecting_same_port_is_idempotent() -> None:
    relay, factory = make_relay_service(FakeSerialFactory())
    relay.connect("COM3")
    relay.on()

    status = relay.connect("COM3")

    assert status.connected is True
    assert status.port == "COM3"
    assert status.relay_state == "on"
    assert len(factory.instances) == 1


def test_connecting_another_port_releases_old_connection_first() -> None:
    relay, factory = make_relay_service(FakeSerialFactory())
    relay.connect("COM3")
    relay.on()

    status = relay.connect("COM5")

    assert status.connected is True
    assert status.port == "COM5"
    assert status.relay_state == "unknown"
    assert len(factory.instances) == 2
    assert factory.instances[0].closed is True


def test_on_after_disconnect_returns_not_connected() -> None:
    relay, _ = make_relay_service(FakeSerialFactory())
    relay.connect("COM3")
    relay.disconnect()

    with pytest.raises(SerialNotConnectedError):
        relay.on()


def test_rapid_on_off_commands_keep_exact_order() -> None:
    relay, factory = make_relay_service(FakeSerialFactory())
    relay.connect("COM3")
    expected: list[bytes] = []

    for index in range(20):
        expected.append(RELAY_ON_COMMAND if index % 2 == 0 else RELAY_OFF_COMMAND)
        relay.on() if index % 2 == 0 else relay.off()

    assert factory.instances[0].writes == expected


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


def test_successful_command_writes_structured_log(caplog: pytest.LogCaptureFixture) -> None:
    relay, _ = make_relay_service(FakeSerialFactory())
    relay.connect("COM3")

    with caplog.at_level(logging.INFO, logger="app.services.relay_service"):
        relay.on()

    payload = _command_log_payload(caplog)
    assert payload["event"] == "relay_command"
    assert payload["action"] == "ON"
    assert payload["command"] == "RELAY_ON"
    assert payload["command_hex"] == "A0 01 01 A2"
    assert payload["port"] == "COM3"
    assert payload["result"] == "success"
    assert payload["success"] is True
    assert payload["timestamp"]


def test_failed_command_writes_structured_log(
    caplog: pytest.LogCaptureFixture,
) -> None:
    relay, _ = make_relay_service(
        FakeSerialFactory(write_error=serial.SerialException("unplugged"))
    )
    relay.connect("COM3")

    with caplog.at_level(logging.INFO, logger="app.services.relay_service"):
        with pytest.raises(SerialWriteError):
            relay.on()

    payload = _command_log_payload(caplog)
    assert payload["action"] == "ON"
    assert payload["command_hex"] == "A0 01 01 A2"
    assert payload["port"] == "COM3"
    assert payload["result"] == "failed"
    assert payload["success"] is False
    assert payload["error_code"] == "SERIAL_WRITE_FAILED"


def _command_log_payload(caplog: pytest.LogCaptureFixture) -> dict[str, object]:
    record = next(
        record
        for record in caplog.records
        if record.name == "app.services.relay_service"
        and "relay_command {" in record.getMessage()
    )
    _, json_payload = record.getMessage().split(" ", 1)
    return json.loads(json_payload)
