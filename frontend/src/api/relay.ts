// Web Serial API based relay control (pure frontend, no backend).
// Browser requirements: Chromium 89+ (Chrome / Edge), served over https or localhost.

export type RelayState = "on" | "off" | "unknown";
export type RelayStateSource = "software_last_command" | "unknown";
export type SerialConnectionState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "error";

export interface SerialPortInfo {
  port: string;
  device: string;
  description: string;
  manufacturer: string | null;
  hwid: string | null;
  is_current: boolean;
}

export interface RelayStatus {
  connected: boolean;
  port: string | null;
  relay_state: RelayState;
  state_source: RelayStateSource;
}

export interface RelayActionResponse {
  success: boolean;
  message: string;
  command: string;
  status: RelayStatus;
}

export interface SerialStatus {
  state: SerialConnectionState;
  port: string | null;
  device: string | null;
  baudrate: number;
  connected: boolean;
  error_code: string | null;
  detail: string | null;
}

export interface HealthResponse {
  status: "ok";
  service: string;
  serial_connected: boolean;
}

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

export interface AuditLogPage {
  items: AuditLogEntry[];
  total: number;
  limit: number;
  offset: number;
}

const RELAY_ON_COMMAND = new Uint8Array([0xa0, 0x01, 0x01, 0xa2]);
const RELAY_OFF_COMMAND = new Uint8Array([0xa0, 0x01, 0x00, 0xa1]);
const SERIAL_BAUDRATE = 9600;

// Known USB vendor ids for common USB-serial chips.
const VENDOR_NAMES: Record<number, string> = {
  0x1a86: "QinHeng Electronics",
  0x0403: "FTDI",
  0x10c4: "Silicon Labs",
  0x067b: "Prolific",
  0x2341: "Arduino",
};

function bytesToHex(value: Uint8Array): string {
  return Array.from(value, (byte) =>
    byte.toString(16).padStart(2, "0").toUpperCase(),
  ).join(" ");
}

function describePort(info: SerialPortUsbInfo): {
  description: string;
  manufacturer: string | null;
  hwid: string | null;
} {
  const vid = info.usbVendorId;
  const pid = info.usbProductId;
  const manufacturer = vid != null ? VENDOR_NAMES[vid] ?? null : null;
  const hwid =
    vid != null && pid != null
      ? `VID_${vid.toString(16).toUpperCase().padStart(4, "0")}&PID_${pid
          .toString(16)
          .toUpperCase()
          .padStart(4, "0")}`
      : null;

  let description = "USB Serial Device";
  if (vid === 0x1a86) {
    description = "USB-SERIAL CH340";
  } else if (vid === 0x0403) {
    description = "USB Serial Converter (FTDI)";
  } else if (vid === 0x10c4) {
    description = "CP210x USB to UART";
  } else if (manufacturer) {
    description = manufacturer;
  }

  return { description, manufacturer, hwid };
}

// ---------------------------------------------------------------------------
// In-memory audit log (mirrors backend AuditLogService, frontend only).
// ---------------------------------------------------------------------------

class AuditLogStore {
  private entries: AuditLogEntry[] = [];
  private readonly maxEntries = 500;

  add(entry: Omit<AuditLogEntry, "timestamp"> & { timestamp?: string }): void {
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

  list(limit: number, offset: number): AuditLogPage {
    const sorted = [...this.entries].reverse();
    const page = sorted.slice(offset, offset + limit);
    return {
      items: page,
      total: this.entries.length,
      limit,
      offset,
    };
  }

  clear(): number {
    const deleted = this.entries.length;
    this.entries = [];
    return deleted;
  }
}

// ---------------------------------------------------------------------------
// Web Serial service singleton.
// ---------------------------------------------------------------------------

class WebSerialRelayService {
  private port: SerialPort | null = null;
  private portIndex: number | null = null;
  private state: SerialConnectionState = "disconnected";
  private errorCode: string | null = null;
  private errorDetail: string | null = null;
  private relayState: RelayState = "unknown";
  private portLabel: string | null = null;
  private audit = new AuditLogStore();

  isSupported(): boolean {
    return typeof navigator !== "undefined" && "serial" in navigator;
  }

  private async grantedPorts(): Promise<SerialPort[]> {
    if (!this.isSupported()) {
      throw new WebSerialUnsupportedError();
    }
    return navigator.serial.getPorts();
  }

  async listPorts(): Promise<SerialPortInfo[]> {
    const ports = await this.grantedPorts();
    const current = this.port;
    return ports.map((port, index) => {
      const info = port.getInfo();
      const { description, manufacturer, hwid } = describePort(info);
      const label = `串口 ${index + 1} · ${description}`;
      return {
        port: String(index),
        device: label,
        description,
        manufacturer,
        hwid,
        is_current: current === port,
      };
    });
  }

  /**
   * Ask the browser to show the serial-port picker. The selected port is added
   * to the granted set and its info is returned.
   */
  async requestPort(): Promise<SerialPortInfo> {
    if (!this.isSupported()) {
      throw new WebSerialUnsupportedError();
    }
    try {
      // Prefer CH340 (LCUS-1 relay), but allow any serial device.
      const port = await navigator.serial.requestPort({
        filters: [{ usbVendorId: 0x1a86 }],
      });
      const ports = await this.grantedPorts();
      const index = ports.indexOf(port);
      const info = port.getInfo();
      const { description, manufacturer, hwid } = describePort(info);
      return {
        port: String(index),
        device: `串口 ${index + 1} · ${description}`,
        description,
        manufacturer,
        hwid,
        is_current: this.port === port,
      };
    } catch (error) {
      if (error instanceof DOMException && error.name === "NotFoundError") {
        throw new SerialUserCancelledError();
      }
      throw error;
    }
  }

  async connect(index: number): Promise<RelayStatus> {
    if (!this.isSupported()) {
      throw new WebSerialUnsupportedError();
    }
    this.state = "connecting";
    this.errorCode = null;
    this.errorDetail = null;

    let port: SerialPort;
    try {
      const ports = await this.grantedPorts();
      port = ports[index];
      if (!port) {
        throw new SerialPortNotFoundError(
          "所选串口不存在，请重新选择串口设备",
        );
      }
    } catch (error) {
      if (error instanceof ServiceError) {
        this.fail(error.code, error.message);
        this.record("CONNECT", "SERIAL_CONNECT", null, null, "failed", error.message, error.code);
        throw error;
      }
      throw error;
    }

    try {
      await port.open({
        baudRate: SERIAL_BAUDRATE,
        dataBits: 8,
        stopBits: 1,
        parity: "none",
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "串口打开失败";
      const mapped = this.mapOpenError(message);
      this.fail(mapped.code, mapped.message);
      this.record("CONNECT", "SERIAL_CONNECT", null, null, "failed", mapped.message, mapped.code);
      throw mapped;
    }

    this.port = port;
    this.portIndex = index;
    this.portLabel = `串口 ${index + 1}`;
    this.state = "connected";
    this.relayState = "unknown";
    this.record(
      "CONNECT",
      "SERIAL_CONNECT",
      null,
      this.portLabel,
      "success",
      `${this.portLabel} 连接成功`,
    );
    return this.getRelayStatus();
  }

  async disconnect(): Promise<RelayStatus> {
    const label = this.portLabel;
    if (this.port) {
      try {
        await this.port.close();
      } catch {
        // Ignore close errors; the port object is being discarded.
      }
    }
    this.port = null;
    this.portIndex = null;
    this.portLabel = null;
    this.state = "disconnected";
    this.relayState = "unknown";
    this.errorCode = null;
    this.errorDetail = null;
    this.record(
      "DISCONNECT",
      "SERIAL_DISCONNECT",
      null,
      label,
      "success",
      `${label ?? "串口"} 已断开`,
    );
    return this.getRelayStatus();
  }

  async on(): Promise<RelayActionResponse> {
    return this.execute(RELAY_ON_COMMAND, "on", "ON");
  }

  async off(): Promise<RelayActionResponse> {
    return this.execute(RELAY_OFF_COMMAND, "off", "OFF");
  }

  getRelayStatus(): RelayStatus {
    const connected = this.state === "connected" && this.port !== null;
    return {
      connected,
      port: connected ? this.portLabel : null,
      relay_state: connected ? this.relayState : "unknown",
      state_source:
        connected && this.relayState !== "unknown"
          ? "software_last_command"
          : "unknown",
    };
  }

  getSerialStatus(): SerialStatus {
    const connected = this.state === "connected" && this.port !== null;
    return {
      state: this.state,
      port: connected ? this.portLabel : this.state === "error" ? this.portLabel : null,
      device: connected ? this.portLabel : null,
      baudrate: SERIAL_BAUDRATE,
      connected,
      error_code: this.errorCode,
      detail: this.errorDetail,
    };
  }

  getHealth(): HealthResponse {
    return {
      status: "ok",
      service: "USB Relay Web (Web Serial)",
      serial_connected: this.state === "connected" && this.port !== null,
    };
  }

  listAuditLogs(limit: number, offset: number): AuditLogPage {
    return this.audit.list(limit, offset);
  }

  clearAuditLogs(): { deleted: number } {
    return { deleted: this.audit.clear() };
  }

  private async execute(
    command: Uint8Array,
    target: RelayState,
    action: "ON" | "OFF",
  ): Promise<RelayActionResponse> {
    if (!this.port || this.state !== "connected") {
      const error = new SerialNotConnectedError("串口尚未连接");
      this.record(
        action,
        `RELAY_${action}`,
        bytesToHex(command),
        this.portLabel,
        "failed",
        error.message,
        error.code,
      );
      throw error;
    }

    const commandText = bytesToHex(command);
    try {
      const writer = this.port.writable?.getWriter();
      if (!writer) {
        throw new SerialWriteError("串口不可写，请重新连接");
      }
      await writer.write(command);
      writer.releaseLock();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "串口写入失败";
      const mapped = new SerialWriteError(
        `串口 ${this.portLabel ?? "当前设备"} 写入失败，设备可能已拔出，请重新连接`,
      );
      this.relayState = "unknown";
      this.fail(mapped.code, mapped.message);
      this.record(
        action,
        `RELAY_${action}`,
        commandText,
        this.portLabel,
        "failed",
        mapped.message,
        mapped.code,
      );
      throw mapped;
    }

    this.relayState = target;
    const detail = `Relay 1 ${action} 指令发送成功`;
    this.record(
      action,
      `RELAY_${action}`,
      commandText,
      this.portLabel,
      "success",
      detail,
    );
    return {
      success: true,
      message: detail,
      command: commandText,
      status: this.getRelayStatus(),
    };
  }

  private fail(code: string, detail: string): void {
    this.state = "error";
    this.errorCode = code;
    this.errorDetail = detail;
    // Keep portLabel so the UI can show which port failed.
  }

  private mapOpenError(message: string): ServiceError {
    const lower = message.toLowerCase();
    if (
      lower.includes("busy") ||
      lower.includes("access") ||
      lower.includes("denied") ||
      lower.includes("占用")
    ) {
      return new PortBusyError(
        "串口正在被其他程序占用，请关闭其他串口软件后重试",
      );
    }
    if (lower.includes("not found") || lower.includes("找不到")) {
      return new SerialPortNotFoundError("串口不存在，请检查设备连接");
    }
    return new SerialConnectionError(
      "连接串口失败，请检查 CH340 驱动和设备状态",
    );
  }

  private record(
    action: string,
    command: string | null,
    hex: string | null,
    port: string | null,
    result: "success" | "failed",
    detail: string,
    errorCode: string | null = null,
  ): void {
    this.audit.add({ action, command, hex, port, result, detail, error_code: errorCode });
  }
}

// ---------------------------------------------------------------------------
// Service errors (mirror backend exception codes).
// ---------------------------------------------------------------------------

export class ServiceError extends Error {
  code = "SERVICE_ERROR";
  constructor(message: string) {
    super(message);
    this.name = "ServiceError";
  }
}

export class WebSerialUnsupportedError extends ServiceError {
  code = "WEB_SERIAL_UNSUPPORTED";
  constructor() {
    super(
      "当前浏览器不支持 Web Serial API，请使用 Chrome 或 Edge (89+) 并通过 https 或 localhost 访问",
    );
    this.name = "WebSerialUnsupportedError";
  }
}

export class SerialUserCancelledError extends ServiceError {
  code = "SERIAL_USER_CANCELLED";
  constructor() {
    super("已取消串口选择");
    this.name = "SerialUserCancelledError";
  }
}

export class SerialPortNotFoundError extends ServiceError {
  code = "SERIAL_PORT_NOT_FOUND";
  constructor(message: string) {
    super(message);
    this.name = "SerialPortNotFoundError";
  }
}

export class PortBusyError extends ServiceError {
  code = "SERIAL_PORT_BUSY";
  constructor(message: string) {
    super(message);
    this.name = "PortBusyError";
  }
}

export class SerialConnectionError extends ServiceError {
  code = "SERIAL_CONNECTION_FAILED";
  constructor(message: string) {
    super(message);
    this.name = "SerialConnectionError";
  }
}

export class SerialNotConnectedError extends ServiceError {
  code = "SERIAL_NOT_CONNECTED";
  constructor(message: string) {
    super(message);
    this.name = "SerialNotConnectedError";
  }
}

export class SerialWriteError extends ServiceError {
  code = "SERIAL_WRITE_FAILED";
  constructor(message: string) {
    super(message);
    this.name = "SerialWriteError";
  }
}

// ---------------------------------------------------------------------------
// Singleton instance and exported functions (keep original API surface).
// ---------------------------------------------------------------------------

const service = new WebSerialRelayService();

export function isWebSerialSupported(): boolean {
  return service.isSupported();
}

export async function listSerialPorts(): Promise<SerialPortInfo[]> {
  return service.listPorts();
}

export async function requestSerialPort(): Promise<SerialPortInfo> {
  return service.requestPort();
}

export async function connectRelay(port: string): Promise<RelayStatus> {
  const index = Number.parseInt(port, 10);
  if (Number.isNaN(index)) {
    throw new SerialPortNotFoundError("串口名称无效");
  }
  return service.connect(index);
}

export async function disconnectRelay(): Promise<RelayStatus> {
  return service.disconnect();
}

export async function turnRelayOn(): Promise<RelayActionResponse> {
  return service.on();
}

export async function turnRelayOff(): Promise<RelayActionResponse> {
  return service.off();
}

export async function getRelayStatus(): Promise<RelayStatus> {
  return service.getRelayStatus();
}

export async function getSerialStatus(): Promise<SerialStatus> {
  return service.getSerialStatus();
}

export async function getHealth(): Promise<HealthResponse> {
  return service.getHealth();
}

export async function listAuditLogs(
  limit = 20,
  offset = 0,
): Promise<AuditLogPage> {
  return service.listAuditLogs(limit, offset);
}

export async function clearAuditLogs(): Promise<{ deleted: number }> {
  return service.clearAuditLogs();
}

export function getApiErrorMessage(error: unknown): string {
  if (error instanceof ServiceError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "发生未知错误";
}
