// In-memory audit log shared by Web and Electron versions.

export interface AuditLogEntry {
  timestamp: string;
  action: string;
  command: string | null;
  hex: string | null;
  port: string | null;
  result: "success" | "failed";
  error_code: string | null;
  detail: string;
}

export class AuditLogStore {
  private entries: AuditLogEntry[] = [];
  private readonly maxEntries = 500;

  add(
    entry: Omit<AuditLogEntry, "timestamp"> & { timestamp?: string },
  ): void {
    const full: AuditLogEntry = {
      timestamp: entry.timestamp ?? new Date().toISOString(),
      action: entry.action,
      command: entry.command,
      hex: entry.hex,
      port: entry.port,
      result: entry.result,
      error_code: entry.error_code,
      detail: entry.detail,
    };
    this.entries.push(full);
    if (this.entries.length > this.maxEntries) {
      this.entries.shift();
    }
  }
}
