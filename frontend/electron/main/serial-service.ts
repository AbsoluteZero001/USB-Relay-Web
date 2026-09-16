import { EventEmitter } from "node:events";
import { SerialPort } from "serialport";
import type { PortInfo } from "@serialport/bindings-interface";

import type {
  SerialOpenOptions,
  SerialPortInfo,
  SerialStatus,
  SerialConnectionState,
} from "../../src/services/serial/types";

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

function describePort(info: PortInfo): {
  description: string;
  manufacturer: string | null;
} {
  const vid = toHex4(info.vendorId);
  const manufacturer = vid ? VENDOR_NAMES[vid] ?? info.manufacturer ?? null : info.manufacturer ?? null;

  let description = info.product || "USB Serial Device";
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
    return ports.map((p) => {
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
  }

  connect(portId: string, options: SerialOpenOptions): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.port) {
        this.port.close(() => {
          this.port = null;
        });
      }

      this.state = "connecting";
      this.errorCode = null;
      this.errorDetail = null;
      this.emitStatus();

      const port = new SerialPort({
        path: portId,
        baudRate: options.baudRate,
        dataBits: options.dataBits,
        stopBits: options.stopBits,
        parity: options.parity as "none" | "even" | "odd" | "mark" | "space",
        autoOpen: false,
      });

      port.open((err) => {
        if (err) {
          const mapped = this.mapOpenError(err.message);
          this.state = "error";
          this.errorCode = mapped.code;
          this.errorDetail = mapped.message;
          this.emitStatus();
          reject(new Error(mapped.message));
          return;
        }

        this.port = port;
        this.currentPath = portId;
        this.baudrate = options.baudRate;
        this.state = "connected";
        this.errorCode = null;
        this.errorDetail = null;

        port.on("data", (data: Buffer) => {
          this.emit("data", Array.from(data));
        });

        port.on("close", () => {
          this.handleClose("设备已断开");
        });

        port.on("error", (err) => {
          this.handleClose(err.message || "串口错误");
        });

        this.emitStatus();
        resolve();
      });
    });
  }

  disconnect(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.port) {
        this.state = "disconnected";
        this.currentPath = null;
        this.errorCode = null;
        this.errorDetail = null;
        this.emitStatus();
        resolve();
        return;
      }

      const port = this.port;
      this.port = null;
      port.close((err) => {
        if (err) {
          // Ignore close errors.
        }
        this.state = "disconnected";
        this.currentPath = null;
        this.errorCode = null;
        this.errorDetail = null;
        this.emitStatus();
        resolve();
      });
    });
  }

  send(data: number[]): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.port || this.state !== "connected") {
        reject(new Error("串口尚未连接"));
        return;
      }
      this.port.write(Buffer.from(data), (err) => {
        if (err) {
          reject(new Error("串口写入失败，设备可能已拔出"));
          return;
        }
        this.port?.drain((drainErr) => {
          if (drainErr) {
            reject(new Error("串口写入失败"));
            return;
          }
          resolve();
        });
      });
    });
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

  private handleClose(detail: string): void {
    this.state = "error";
    this.errorCode = "SERIAL_DEVICE_DISCONNECTED";
    this.errorDetail = detail;
    this.port = null;
    this.emitStatus();
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
