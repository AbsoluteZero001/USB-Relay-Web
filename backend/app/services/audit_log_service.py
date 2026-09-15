import logging
import threading
from collections import deque
from datetime import datetime, timezone

from app.models.audit import AuditLogEntry, AuditLogPage, AuditResult

logger = logging.getLogger(__name__)


class AuditLogService:
    """Thread-safe in-memory operation history."""

    def __init__(self, max_entries: int = 500) -> None:
        if max_entries < 1:
            raise ValueError("max_entries 必须大于 0")
        self._entries: deque[AuditLogEntry] = deque(maxlen=max_entries)
        self._lock = threading.RLock()

    def add(
        self,
        *,
        action: str,
        command: str | None,
        hex_value: str | None,
        port: str | None,
        result: AuditResult,
        detail: str,
        error_code: str | None = None,
        timestamp: datetime | None = None,
    ) -> AuditLogEntry:
        entry = AuditLogEntry(
            timestamp=timestamp or datetime.now(timezone.utc),
            action=action,
            command=command,
            hex=hex_value,
            port=port,
            result=result,
            error_code=error_code,
            detail=detail,
        )
        with self._lock:
            self._entries.append(entry)
        return entry

    def list_entries(self, *, limit: int, offset: int) -> AuditLogPage:
        with self._lock:
            entries = sorted(
                self._entries,
                key=lambda entry: entry.timestamp,
                reverse=True,
            )
            total = len(entries)
            page = entries[offset : offset + limit]
        return AuditLogPage(
            items=page,
            total=total,
            limit=limit,
            offset=offset,
        )

    def clear(self) -> int:
        with self._lock:
            deleted = len(self._entries)
            self._entries.clear()
        logger.info("内存操作日志已清空，共删除 %d 条", deleted)
        return deleted
