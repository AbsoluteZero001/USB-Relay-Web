import type { SerialAdapter } from "./serial/SerialAdapter";
import { isRequestable } from "./serial/SerialAdapter";
import type {
  SerialPortInfo,
  SerialStatus,
} from "./serial/types";
import { DEFAULT_CONFIG, type RelayConfig } from "./config/types";
import { formatHexBytes } from "./hex";
import {
  OperationTimeoutError,
  withTimeout,
} from "./serial/timeout";
import {
  PortBusyError,
  SerialConnectionError,
  SerialNotConnectedError,
  SerialPortNotFoundError,
  SerialWriteError,
  ServiceError,
  WebSerialUnsupportedError,
} from "./errors";

const SEND_TIMEOUT_MS = 6000;
const DISCONNECT_TIMEOUT_MS = 1500;

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
  serial_supported: boolean;
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

  constructor(
    adapter: SerialAdapter,
    config: RelayConfig = DEFAULT_CONFIG.relay,
  ) {
    this.adapter = adapter;
    this.config = config;
  }

  /** Replace the active config (e.g. after user changes settings). */
  updateConfig(config: RelayConfig): void {
    this.config = config;
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
      throw this.mapError(error);
    }

    this.connectedPort = portId;
    this.relayState = "unknown";
    return this.getRelayStatus();
  }

  async disconnect(): Promise<RelayStatus> {
    try {
      await this.adapter.disconnect();
    } catch {
      // Ignore disconnect errors.
    }
    this.connectedPort = null;
    this.relayState = "unknown";
    return this.getRelayStatus();
  }

  /** Reopen the current port so new serial options take effect immediately. */
  async reconnect(portId: string): Promise<RelayStatus> {
    await this.disconnect();
    return this.connect(portId);
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
      serial_supported: this.adapter.isSupported(),
    };
  }

  private async execute(
    command: number[],
    target: RelayState,
    action: "ON" | "OFF",
  ): Promise<RelayActionResponse> {
    const status = this.adapter.getStatus();
    if (!status.connected) {
      throw new SerialNotConnectedError("串口尚未连接");
    }

    const commandText = formatHexBytes(command);
    const timeoutMessage = `串口 ${this.connectedPort ?? "当前设备"} 写入超时，设备可能未连接或未响应`;
    try {
      await withTimeout(
        this.adapter.send(new Uint8Array(command)),
        SEND_TIMEOUT_MS,
        timeoutMessage,
      );
    } catch (error) {
      const detail = error instanceof Error ? error.message : "";
      const timedOut =
        error instanceof OperationTimeoutError || detail.includes("超时");
      if (timedOut) {
        try {
          await withTimeout(
            this.adapter.disconnect(),
            DISCONNECT_TIMEOUT_MS,
            "关闭串口超时",
          );
        } catch {
          // The adapter is already being discarded after the write timeout.
        }
        this.connectedPort = null;
      }
      const mapped = new SerialWriteError(
        timedOut
          ? timeoutMessage
          : `串口 ${this.connectedPort ?? "当前设备"} 写入失败，设备可能已拔出，请重新连接`,
      );
      this.relayState = "unknown";
      throw mapped;
    }

    this.relayState = target;
    const channel = this.config.currentChannel || 1;
    const detail = `继电器 ${channel} ${action} 指令发送成功`;
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
}
