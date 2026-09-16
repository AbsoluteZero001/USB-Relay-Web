import { EventEmitter } from "node:events";
import { SerialPort } from "serialport";

import type {
  SerialOpenOptions,
  SerialPortInfo,
  SerialStatus,
  SerialConnectionState,
} from "../../src/services/serial/types";
import { toNodeFlowControlOptions } from "../../src/services/serial/flow-control";
import {
  OperationTimeoutError,
  withTimeout,
} from "../../src/services/serial/timeout";

const OPEN_TIMEOUT_MS = 5000;
const PROBE_TIMEOUT_MS = 1500;
const WRITE_TIMEOUT_MS = 4000;
const CLOSE_TIMEOUT_MS = 1500;

// Known USB vendor ids for common USB-serial chips.
const VENDOR_NAMES: Record<string, string> = {
  "1A86": "QinHeng Electronics (CH340)",
  "0403": "FTDI",
  "10C4": "Silicon Labs (CP210x)",
  "067B": "Prolific",
  "2341": "Arduino",
};

function toHex4(value: string | undefined): string | null {
  if (!value) return null;
  const cleaned = value.replace(/^0x/i, "").toUpperCase();
  return cleaned.padStart(4, "0");
}

interface SerialPortBindingInfo {
  path: string;
  manufacturer?: string;
  serialNumber?: string;
  pnpId?: string;
  locationId?: string;
  productId?: string;
  vendorId?: string;
  friendlyName?: string;
}

function describePort(info: SerialPortBindingInfo): {
  description: string;
  manufacturer: string | null;
} {
  const vid = toHex4(info.vendorId);
  const manufacturer = vid ? VENDOR_NAMES[vid] ?? info.manufacturer ?? null : info.manufacturer ?? null;

  let description = info.friendlyName?.trim() || "USB Serial Device";
  if (vid === "1A86") {
    description = "USB-SERIAL CH340";
  } else if (vid === "0403") {
    description = "USB Serial Converter (FTDI)";
  } else if (vid === "10C4") {
    description = "CP210x USB to UART";
  }
  return { description, manufacturer };
}

/**
 * Serial-port service running in the Electron main process.
 *
 * Owns the Node SerialPort instance and exposes operations through IPC.
 * Emits "status-change" and "data" events that the main process forwards
 * to the renderer.
 */
export class SerialService extends EventEmitter {
  private port: SerialPort | null = null;
  private state: SerialConnectionState = "disconnected";
  private errorCode: string | null = null;
  private errorDetail: string | null = null;
  private currentPath: string | null = null;
  private baudrate = 9600;

  async listPorts(): Promise<SerialPortInfo[]> {
    const ports = await SerialPort.list();
    const currentPath = this.currentPath;
    const mapped = ports.map((p) => {
      const { description, manufacturer } = describePort(p);
      const vid = toHex4(p.vendorId);
      const pid = toHex4(p.productId);
      return {
        port: p.path,
        device: `${p.path} · ${description}`,
        description,
        manufacturer,
        hwid:
          vid && pid ? `VID_${vid}&PID_${pid}` : p.pnpId ?? null,
        vendorId: vid,
        productId: pid,
        serialNumber: p.serialNumber ?? null,
        is_current: currentPath === p.path,
      };
    });

    if (
      currentPath &&
      !mapped.some((port) => port.port === currentPath)
    ) {
      mapped.push({
        port: currentPath,
        device: `${currentPath} · 当前串口`,
        description: "当前串口",
        manufacturer: null,
        hwid: null,
        vendorId: null,
        productId: null,
        serialNumber: null,
        is_current: true,
      });
    }

    return mapped;
  }

  async connect(portId: string, options: SerialOpenOptions): Promise<void> {
    if (
      this.port &&
      this.state === "connected" &&
      this.currentPath === portId
    ) {
      return;
    }

    if (this.port) {
      const previousPort = this.port;
      this.port = null;
      await this.closePort(previousPort);
    }

    this.state = "connecting";
    this.currentPath = portId;
    this.errorCode = null;
    this.errorDetail = null;
    this.emitStatus();

    const port = new SerialPort({
      path: portId,
      baudRate: options.baudRate,
      dataBits: options.dataBits,
      stopBits: options.stopBits,
      parity: options.parity as "none" | "even" | "odd" | "mark" | "space",
      ...toNodeFlowControlOptions(options.flowControl),
      autoOpen: false,
    });

    let openTimedOut = false;
    try {
      await withTimeout(
        new Promise<void>((resolve, reject) => {
          port.open((err) => {
            if (openTimedOut) {
              if (!err) {
                void this.closePort(port);
              }
              if (err) {
                reject(err);
              } else {
                resolve();
              }
              return;
            }
            if (err) {
              reject(err);
              return;
            }
            resolve();
          });
        }),
        OPEN_TIMEOUT_MS,
        `${portId} 打开超时，未检测到可用串口设备`,
        () => {
          openTimedOut = true;
        },
      );
    } catch (error) {
      const mapped =
        openTimedOut || error instanceof OperationTimeoutError
          ? {
              code: "SERIAL_OPEN_TIMEOUT",
              message: `${portId} 打开超时，未检测到可用串口设备。请确认继电器已插入且端口未被占用。`,
            }
          : this.mapOpenError(
              error instanceof Error ? error.message : "串口打开失败",
            );
      this.state = "error";
      this.errorCode = mapped.code;
      this.errorDetail = mapped.message;
      await this.closePort(port);
      this.emitStatus();
      throw new Error(mapped.message);
    }

    try {
      await this.probePort(port, portId);
    } catch {
      const message = `${portId} 已打开但设备无响应，可能是不存在的串口或设备未连接`;
      this.state = "error";
      this.errorCode = "SERIAL_PORT_UNRESPONSIVE";
      this.errorDetail = message;
      await this.closePort(port);
      this.emitStatus();
      throw new Error(message);
    }

    this.port = port;
    this.baudrate = options.baudRate;
    this.state = "connected";
    this.errorCode = null;
    this.errorDetail = null;

    port.on("data", (data: Buffer) => {
      this.emit("data", Array.from(data));
    });

    port.on("close", () => {
      if (this.port !== port) {
        return;
      }
      this.handleClose("设备已断开");
    });

    port.on("error", (err) => {
      if (this.port !== port) {
        return;
      }
      this.handleClose(err.message || "串口错误");
    });

    this.emitStatus();
  }

  async disconnect(): Promise<void> {
    const port = this.port;
    this.port = null;

    if (port) {
      await this.closePort(port);
    }

    this.state = "disconnected";
    this.currentPath = null;
    this.errorCode = null;
    this.errorDetail = null;
    this.emitStatus();
  }

  async send(data: number[]): Promise<void> {
    const port = this.port;
    if (!port || this.state !== "connected") {
      throw new Error("串口尚未连接");
    }

    let writeTimedOut = false;
    let cleanupWriteError = (): void => undefined;
    const timeoutMessage = `串口 ${this.currentPath ?? ""} 写入超时，设备可能未连接或未响应`;
    try {
      const writeOperation = new Promise<void>((resolve, reject) => {
        const handlePortError = (error: Error): void => {
          reject(error);
        };
        port.once("error", handlePortError);

        cleanupWriteError = (): void => {
          port.off("error", handlePortError);
        };

        port.write(Buffer.from(data), (err) => {
          if (err) {
            cleanupWriteError();
            reject(err);
            return;
          }
          port.drain((drainErr) => {
            cleanupWriteError();
            if (drainErr) {
              reject(drainErr);
              return;
            }
            resolve();
          });
        });
      });

      await withTimeout(
        writeOperation,
        WRITE_TIMEOUT_MS,
        timeoutMessage,
        () => {
          writeTimedOut = true;
          cleanupWriteError();
        },
      );
    } catch (error) {
      const timedOut =
        writeTimedOut || error instanceof OperationTimeoutError;
      const detail = timedOut
        ? timeoutMessage
        : "串口写入失败，设备可能已拔出";
      this.handleClose(
        detail,
        timedOut ? "SERIAL_WRITE_TIMEOUT" : "SERIAL_DEVICE_DISCONNECTED",
      );
      throw new Error(detail);
    }
  }

  getStatus(): SerialStatus {
    const connected = this.state === "connected" && this.port !== null;
    return {
      state: this.state,
      port: connected || this.state === "error" ? this.currentPath : null,
      device: connected ? this.currentPath : null,
      baudrate: this.baudrate,
      connected,
      error_code: this.errorCode,
      detail: this.errorDetail,
    };
  }

  private handleClose(
    detail: string,
    errorCode = "SERIAL_DEVICE_DISCONNECTED",
  ): void {
    const port = this.port;
    this.state = "error";
    this.errorCode = errorCode;
    this.errorDetail = detail;
    this.port = null;
    this.currentPath = null;
    if (port) {
      void this.closePort(port);
    }
    this.emitStatus();
  }

  private async closePort(port: SerialPort): Promise<void> {
    if (!port.isOpen) return;
    try {
      await withTimeout(
        new Promise<void>((resolve) => {
          port.close(() => resolve());
        }),
        CLOSE_TIMEOUT_MS,
        "关闭串口超时",
      );
    } catch {
      // Closing is best-effort; the service state is reset by the caller.
    }
  }

  private async probePort(
    port: SerialPort,
    portId: string,
  ): Promise<void> {
    await withTimeout(
      new Promise<void>((resolve, reject) => {
        port.get((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      }),
      PROBE_TIMEOUT_MS,
      `${portId} 设备探测超时`,
    );
  }

  private emitStatus(): void {
    this.emit("status-change", this.getStatus());
  }

  private mapOpenError(message: string): { code: string; message: string } {
    const lower = message.toLowerCase();
    if (
      lower.includes("busy") ||
      lower.includes("access") ||
      lower.includes("denied") ||
      lower.includes("占用") ||
      lower.includes("拒绝访问")
    ) {
      return {
        code: "SERIAL_PORT_BUSY",
        message: `${this.currentPath ?? "串口"} 无法打开，可能被其他程序占用。请关闭串口调试工具后重试。`,
      };
    }
    if (lower.includes("not found") || lower.includes("找不到") || lower.includes("no such file")) {
      return {
        code: "SERIAL_PORT_NOT_FOUND",
        message: "串口不存在，请检查设备连接",
      };
    }
    return {
      code: "SERIAL_CONNECTION_FAILED",
      message: "连接串口失败，请检查 CH340 驱动和设备状态",
    };
  }
}
