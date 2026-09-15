from datetime import datetime, timedelta, timezone

from app.services.audit_log_service import AuditLogService


def test_audit_logs_are_newest_first_and_paginated() -> None:
    service = AuditLogService()
    base = datetime(2026, 1, 1, tzinfo=timezone.utc)

    for index in range(5):
        service.add(
            action=f"ACTION_{index}",
            command="RELAY_TEST",
            hex_value=f"00 0{index}",
            port="COM3",
            result="success",
            detail=f"detail {index}",
            timestamp=base + timedelta(seconds=index),
        )

    page = service.list_entries(limit=2, offset=1)

    assert page.total == 5
    assert page.limit == 2
    assert page.offset == 1
    assert [entry.action for entry in page.items] == ["ACTION_3", "ACTION_2"]
    assert page.items[0].timestamp > page.items[1].timestamp


def test_audit_logs_store_failures_and_clear_all_entries() -> None:
    service = AuditLogService()
    service.add(
        action="OFF",
        command="RELAY_OFF",
        hex_value="A0 01 00 A1",
        port="COM3",
        result="failed",
        error_code="SERIAL_WRITE_FAILED",
        detail="写入失败",
    )

    entry = service.list_entries(limit=20, offset=0).items[0]

    assert entry.action == "OFF"
    assert entry.command == "RELAY_OFF"
    assert entry.hex == "A0 01 00 A1"
    assert entry.port == "COM3"
    assert entry.result == "failed"
    assert entry.error_code == "SERIAL_WRITE_FAILED"
    assert entry.detail == "写入失败"
    assert service.clear() == 1
    assert service.list_entries(limit=20, offset=0).total == 0


def test_audit_logs_enforce_maximum_size() -> None:
    service = AuditLogService(max_entries=2)

    for index in range(3):
        service.add(
            action=f"ACTION_{index}",
            command=None,
            hex_value=None,
            port=None,
            result="success",
            detail="test",
        )

    page = service.list_entries(limit=20, offset=0)

    assert page.total == 2
    assert [entry.action for entry in page.items] == ["ACTION_2", "ACTION_1"]
