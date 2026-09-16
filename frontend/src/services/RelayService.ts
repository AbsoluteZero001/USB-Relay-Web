import type { SerialAdapter } from "./serial/SerialAdapter";
import { isRequestable } from "./serial/SerialAdapter";
import type {
  SerialOpenOptions,
  SerialPortInfo,
  SerialStatus,
} from "./serial/types";
import { AuditLogStore } from "./AuditLogStore";
import {
  PortBusyError,
  SerialConnectionError,
  SerialNotConnectedError,
  SerialPortNotFoundError,
  SerialWriteError,
  ServiceError,
  WebSerialUnsupportedError,
} from "./errors";

export type RelayState = "on" | "off" | "unknown";
export type RelayStateSource = "software_last_command" | "unknown";

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

export interface HealthResponse {
  status: "ok";
  service: string;
  serial_connected: boolean;
}

export interface RelayConfig {
  /** Number of relay channels. */
  channels: number;
  /** ON command bytes for channel 1 (LCUS-1 default). */
  onCommand: number[];
  /** OFF command bytes for channel 1 (LCUS-1 default). */
  offCommand: number[];
  /** Serial port open options. */
  serial: SerialOpenOptions;
}

export const DEFAULT_RELAY_CONFIG: RelayConfig = {
  channels: 1,
  onCommand: [0xa0, 0x01, 0x01, 0xa2],
  offCommand: [0xa0, 0x01, 0x00, 0xa1],
  serial: {
    baudRate: 9600,
    dataBits: 8,
    stopBits: 1,
    parity: "none",
    flowControl: "none",
  },
};

function bytesToHex(value: Uint8Array | number[]): string {
  return Array.from(value, (byte) =>
    byte.toString(16).padStart(2, "0").toUpperCase(),
  ).join(" ");
}

/**
 * High-level relay control service.
 *
 * Depends only on the SerialAdapter interface, so the same business logic
 * runs on top of Web Serial (browser) or Node SerialPort (Electron).
 */
export class RelayService {
  private adapter: SerialAdapter;
  private config: RelayConfig;
  private relayState: RelayState = "unknown";
  private connectedPort: string | null = null;
  private audit = new AuditLogStore();

  constructor(adapter: SerialAdapter, config: RelayConfig = DEFAULT_RELAY_CONFIG) {
    this.adapter = adapter;
    this.config = config;
  }

  /** Replace the active config (e.g. after user changes settings). */
  updateConfig(config: RelayConfig): void {
    this.config = config;
  }

  getConfig(): RelayConfig {
    return { ...this.config };
  }

  isSupported(): boolean {
    return this.adapter.isSupported();
  }

  async listPorts(): Promise<SerialPortInfo[]> {
    this.ensureSupported();
    return this.adapter.listPorts();
  }

  async requestPort(): Promise<SerialPortInfo> {
    this.ensureSupported();
    if (isRequestable(this.adapter)) {
      return this.adapter.requestPort();
    }
    // Electron adapter auto-lists all ports; "request" just returns the list.
    const ports = await this.adapter.listPorts();
    if (ports.length === 0) {
      throw new SerialPortNotFoundError("未发现可用串口设备");
    }
    return ports[0];
  }

  async connect(portId: string): Promise<RelayStatus> {
    this.ensureSupported();
    try {
      await this.adapter.connect(portId, this.config.serial);
    } catch (error) {
      const mapped = this.mapError(error);
      this.record(
        "CONNECT",
        "SERIAL_CONNECT",
        null,
        portId,
        "failed",
        mapped.message,
        mapped.code,
      );
      throw mapped;
    }

    this.connectedPort = portId;
    this.relayState = "unknown";
    this.record(
      "CONNECT",
      "SERIAL_CONNECT",
      null,
      portId,
      "success",
      `串口 ${portId} 连接成功`,
    );
    return this.getRelayStatus();
  }

  async disconnect(): Promise<RelayStatus> {
    const port = this.connectedPort;
    try {
      await this.adapter.disconnect();
    } catch {
      // Ignore disconnect errors.
    }
    this.connectedPort = null;
    this.relayState = "unknown";
    this.record(
      "DISCONNECT",
      "SERIAL_DISCONNECT",
      null,
      port,
      "success",
      `${port ?? "串口"} 已断开`,
    );
    return this.getRelayStatus();
  }

  async on(): Promise<RelayActionResponse> {
    return this.execute(this.config.onCommand, "on", "ON");
  }

  async off(): Promise<RelayActionResponse> {
    return this.execute(this.config.offCommand, "off", "OFF");
  }

  getRelayStatus(): RelayStatus {
    const status = this.adapter.getStatus();
    const connected = status.connected;
    return {
      connected,
      port: connected ? this.connectedPort : null,
      relay_state: connected ? this.relayState : "unknown",
      state_source:
        connected && this.relayState !== "unknown"
          ? "software_last_command"
          : "unknown",
    };
  }

  getSerialStatus(): SerialStatus {
    return this.adapter.getStatus();
  }

  getHealth(): HealthResponse {
    return {
      status: "ok",
      service: `USB Relay (${this.adapter.name})`,
      serial_connected: this.adapter.getStatus().connected,
    };
  }

  listAuditLogs(limit: number, offset: number) {
    return this.audit.list(limit, offset);
  }

  clearAuditLogs(): { deleted: number } {
    return { deleted: this.audit.clear() };
  }

  private async execute(
    command: number[],
    target: RelayState,
    action: "ON" | "OFF",
  ): Promise<RelayActionResponse> {
    const status = this.adapter.getStatus();
    if (!status.connected) {
      const error = new SerialNotConnectedError("串口尚未连接");
      this.record(
        action,
        `RELAY_${action}`,
        bytesToHex(command),
        this.connectedPort,
        "failed",
        error.message,
        error.code,
      );
      throw error;
    }

    const commandText = bytesToHex(command);
    try {
      await this.adapter.send(new Uint8Array(command));
    } catch (error) {
      const mapped = new SerialWriteError(
        `串口 ${this.connectedPort ?? "当前设备"} 写入失败，设备可能已拔出，请重新连接`,
      );
      this.relayState = "unknown";
      this.record(
        action,
        `RELAY_${action}`,
        commandText,
        this.connectedPort,
        "failed",
        mapped.message,
        mapped.code,
      );
      throw mapped;
    }

    this.relayState = target;
    const detail = `继电器 1 ${action} 指令发送成功`;
    this.record(
      action,
      `RELAY_${action}`,
      commandText,
      this.connectedPort,
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

  private ensureSupported(): void {
    if (!this.adapter.isSupported()) {
      throw new WebSerialUnsupportedError();
    }
  }

  private mapError(error: unknown): ServiceError {
    if (error instanceof ServiceError) return error;
    const message = error instanceof Error ? error.message : "串口操作失败";
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
      "连接串口失败，请检查驱动和设备状态",
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
    this.audit.add({
      action,
      command,
      hex,
      port,
      result,
      detail,
      error_code: errorCode,
    });
  }
}
