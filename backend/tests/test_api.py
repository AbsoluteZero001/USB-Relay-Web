from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from app.services.serial_service import SerialService
from tests.fakes import (
    FakeSerialFactory,
    access_denied_error,
    fake_port_lister,
)


def make_client(factory: FakeSerialFactory | None = None) -> TestClient:
    serial_service = SerialService(
        Settings(),
        serial_factory=factory or FakeSerialFactory(),
        port_lister=fake_port_lister,
    )
    return TestClient(
        create_app(settings=Settings(), serial_service=serial_service)
    )


def test_openapi_contains_required_api_paths() -> None:
    client = make_client()

    paths = client.get("/openapi.json").json()["paths"]

    assert set(paths) == {
        "/api/serial/ports",
        "/api/serial/status",
        "/api/relay/connect",
        "/api/relay/disconnect",
        "/api/relay/on",
        "/api/relay/off",
        "/api/relay/status",
        "/api/logs",
        "/api/health",
    }


def test_ports_connect_on_off_status_flow() -> None:
    factory = FakeSerialFactory()
    with make_client(factory) as client:
        ports = client.get("/api/serial/ports")
        assert ports.status_code == 200
        assert ports.json()[0]["port"] == "COM3"
        assert ports.json()[0]["device"] == "COM3"
        assert ports.json()[0]["description"] == "USB-SERIAL CH340"
        assert ports.json()[0]["is_current"] is False

        connected = client.post("/api/relay/connect", json={"port": "COM3"})
        assert connected.status_code == 200
        assert connected.json()["connected"] is True
        assert connected.json()["relay_state"] == "unknown"

        ports_while_connected = client.get("/api/serial/ports").json()
        assert ports_while_connected[0]["is_current"] is True

        turned_on = client.post("/api/relay/on")
        assert turned_on.status_code == 200
        assert turned_on.json()["command"] == "A0 01 01 A2"
        assert turned_on.json()["status"]["relay_state"] == "on"

        turned_off = client.post("/api/relay/off")
        assert turned_off.status_code == 200
        assert turned_off.json()["command"] == "A0 01 00 A1"
        assert turned_off.json()["status"]["relay_state"] == "off"

        status = client.get("/api/relay/status")
        assert status.status_code == 200
        assert status.json()["port"] == "COM3"

        disconnected = client.post("/api/relay/disconnect")
        assert disconnected.status_code == 200
        assert disconnected.json()["connected"] is False

    assert factory.instances[0].closed


def test_relay_command_without_connection_returns_readable_error() -> None:
    with make_client() as client:
        response = client.post("/api/relay/on")

    assert response.status_code == 409
    assert response.json() == {
        "detail": "串口尚未连接",
        "code": "SERIAL_NOT_CONNECTED",
    }


def test_health_does_not_require_serial_hardware() -> None:
    with make_client() as client:
        response = client.get("/api/health")

    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "service": "USB Relay Web",
        "serial_connected": False,
    }


def test_serial_status_tracks_lifecycle_states() -> None:
    factory = FakeSerialFactory()
    with make_client(factory) as client:
        initial = client.get("/api/serial/status")
        assert initial.status_code == 200
        assert initial.json() == {
            "state": "disconnected",
            "port": None,
            "device": None,
            "baudrate": 9600,
            "connected": False,
            "error_code": None,
            "detail": None,
        }

        client.post("/api/relay/connect", json={"port": "COM3"})
        connected = client.get("/api/serial/status")
        assert connected.json() == {
            "state": "connected",
            "port": "COM3",
            "device": "USB-SERIAL CH340",
            "baudrate": 9600,
            "connected": True,
            "error_code": None,
            "detail": None,
        }

        factory.instances[0].unplug()
        failed = client.get("/api/serial/status")
        assert failed.json()["state"] == "error"
        assert failed.json()["connected"] is False
        assert failed.json()["port"] == "COM3"
        assert failed.json()["error_code"] == "SERIAL_DEVICE_DISCONNECTED"


def test_invalid_port_payload_returns_validation_error() -> None:
    with make_client() as client:
        response = client.post("/api/relay/connect", json={"port": "   "})

    assert response.status_code == 422


def test_busy_port_returns_readable_error() -> None:
    factory = FakeSerialFactory(open_error=access_denied_error())
    with make_client(factory) as client:
        response = client.post("/api/relay/connect", json={"port": "COM3"})

    assert response.status_code == 409
    assert response.json() == {
        "detail": (
            "串口 COM3 正在被其他程序占用，"
            "请关闭 SSCOM 等串口软件后重试"
        ),
        "code": "SERIAL_PORT_BUSY",
    }
    assert "Traceback" not in response.text


def test_duplicate_connection_is_idempotent() -> None:
    factory = FakeSerialFactory()
    with make_client(factory) as client:
        client.post("/api/relay/connect", json={"port": "COM3"})
        response = client.post("/api/relay/connect", json={"port": "COM3"})

    assert response.status_code == 200
    assert response.json()["connected"] is True
    assert len(factory.instances) == 1


def test_switching_port_releases_previous_connection() -> None:
    factory = FakeSerialFactory()
    with make_client(factory) as client:
        client.post("/api/relay/connect", json={"port": "COM3"})
        response = client.post("/api/relay/connect", json={"port": "COM5"})

    assert response.status_code == 200
    assert response.json()["port"] == "COM5"
    assert factory.instances[0].closed is True
    assert factory.instances[1].port == "COM5"


def test_unhandled_error_returns_structured_error_without_traceback() -> None:
    app = create_app(
        settings=Settings(),
        serial_service=SerialService(
            Settings(),
            serial_factory=FakeSerialFactory(),
            port_lister=fake_port_lister,
        ),
    )

    @app.get("/api/test-internal-error", include_in_schema=False)
    def internal_error() -> None:
        raise RuntimeError("private failure detail")

    with TestClient(app, raise_server_exceptions=False) as client:
        response = client.get("/api/test-internal-error")

    assert response.status_code == 500
    assert response.json() == {
        "detail": "后端发生内部错误，请查看服务日志",
        "code": "INTERNAL_SERVER_ERROR",
    }
    assert "private failure detail" not in response.text
    assert "Traceback" not in response.text


def test_logs_are_newest_first_paginated_and_clearable() -> None:
    with make_client() as client:
        client.get("/api/health")
        client.post("/api/relay/connect", json={"port": "COM3"})
        client.post("/api/relay/on")
        client.post("/api/relay/off")

        response = client.get("/api/logs", params={"limit": 2, "offset": 1})
        assert response.status_code == 200
        payload = response.json()
        assert payload["total"] == 3
        assert payload["limit"] == 2
        assert payload["offset"] == 1
        assert [item["action"] for item in payload["items"]] == ["ON", "CONNECT"]
        assert payload["items"][0]["hex"] == "A0 01 01 A2"
        assert payload["items"][0]["result"] == "success"
        assert payload["items"][0]["error_code"] is None
        assert payload["items"][0]["timestamp"]

        deleted = client.delete("/api/logs")
        assert deleted.status_code == 200
        assert deleted.json() == {"deleted": 3}
        assert client.get("/api/logs").json() == {
            "items": [],
            "total": 0,
            "limit": 20,
            "offset": 0,
        }


def test_failed_operation_is_written_to_audit_logs() -> None:
    with make_client() as client:
        failed = client.post("/api/relay/on")
        assert failed.status_code == 409

        logs = client.get("/api/logs").json()["items"]

    assert len(logs) == 1
    assert logs[0]["action"] == "ON"
    assert logs[0]["hex"] == "A0 01 01 A2"
    assert logs[0]["port"] is None
    assert logs[0]["result"] == "failed"
    assert logs[0]["error_code"] == "SERIAL_NOT_CONNECTED"
    assert logs[0]["detail"] == "串口尚未连接"


def test_logs_pagination_parameters_are_validated() -> None:
    with make_client() as client:
        assert client.get("/api/logs", params={"limit": 0}).status_code == 422
        assert client.get("/api/logs", params={"offset": -1}).status_code == 422


def test_shutdown_closes_active_serial_connection() -> None:
    factory = FakeSerialFactory()
    serial_service = SerialService(
        Settings(),
        serial_factory=factory,
        port_lister=fake_port_lister,
    )
    app = create_app(settings=Settings(), serial_service=serial_service)

    with TestClient(app) as client:
        client.post("/api/relay/connect", json={"port": "COM3"})
        assert factory.instances[0].is_open is True

    assert factory.instances[0].closed is True
    status = serial_service.get_status()
    assert status.connected is False
    assert status.state == "disconnected"


def test_configured_vite_origin_is_allowed() -> None:
    with make_client() as client:
        response = client.options(
            "/api/logs",
            headers={
                "Origin": "http://localhost:5173",
                "Access-Control-Request-Method": "DELETE",
            },
        )

    assert response.status_code == 200
    assert (
        response.headers["access-control-allow-origin"]
        == "http://localhost:5173"
    )
    assert "DELETE" in response.headers["access-control-allow-methods"]
