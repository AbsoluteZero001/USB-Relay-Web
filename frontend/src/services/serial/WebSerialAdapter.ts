import type {
  RequestableSerialAdapter,
} from "./SerialAdapter";
import type {
  SerialConnectionState,
  SerialOpenOptions,
  SerialPortInfo,
  SerialStatus,
} from "./types";
import { withTimeout } from "./timeout";

const WRITE_TIMEOUT_MS = 4000;
const CLOSE_TIMEOUT_MS = 1500;

// Known USB vendor ids for common USB-serial chips.
const VENDOR_NAMES: Record<number, string> = {
  0x1a86: "QinHeng Electronics",
  0x0403: "FTDI",
  0x10c4: "Silicon Labs",
  0x067b: "Prolific",
  0x2341: "Arduino",
};

function toHex4(value: number | undefined): string | null {
  if (value == null) return null;
  return value.toString(16).toUpperCase().padStart(4, "0");
}

function describePort(info: SerialPortUsbInfo): {
  description: string;
  manufacturer: string | null;
} {
  const vid = info.usbVendorId;
  const manufacturer = vid != null ? VENDOR_NAMES[vid] ?? null : null;

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
  return { description, manufacturer };
}

/**
 * Web Serial API adapter.
 * Works in Chromium-based browsers (Chrome / Edge 89+) served over
 * https or localhost.
 */
export class WebSerialAdapter implements RequestableSerialAdapter {
  readonly name = "WebSerial";

  private port: SerialPort | null = null;
  private portIndex: number | null = null;
  private state: SerialConnectionState = "disconnected";
  private errorCode: string | null = null;
  private errorDetail: string | null = null;
  private baudrate = 9600;
  private listeners = new Set<(data: Uint8Array) => void>();
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private readLoopAbort: AbortController | null = null;
  private readLoopPromise: Promise<void> | null = null;

  isSupported(): boolean {
    return typeof navigator !== "undefined" && "serial" in navigator;
  }

  async listPorts(): Promise<SerialPortInfo[]> {
    if (!this.isSupported()) {
      throw new Error("Web Serial API is not supported in this environment");
    }
    const ports = await navigator.serial.getPorts();
    const current = this.port;
    return ports.map((port, index) => {
      const info = port.getInfo();
      const { description, manufacturer } = describePort(info);
      const label = `串口 ${index + 1} · ${description}`;
      return {
        port: String(index),
        device: label,
        description,
        manufacturer,
        hwid:
          info.usbVendorId != null && info.usbProductId != null
            ? `VID_${toHex4(info.usbVendorId)}&PID_${toHex4(info.usbProductId)}`
            : null,
        vendorId: toHex4(info.usbVendorId),
        productId: toHex4(info.usbProductId),
        serialNumber: null,
        is_current: current === port,
      };
    });
  }

  async requestPort(): Promise<SerialPortInfo> {
    if (!this.isSupported()) {
      throw new Error("Web Serial API is not supported in this environment");
    }
    try {
      // Prefer CH340 (LCUS-1 relay), but allow any serial device.
      const port = await navigator.serial.requestPort();
      const ports = await navigator.serial.getPorts();
      const index = ports.indexOf(port);
      const info = port.getInfo();
      const { description, manufacturer } = describePort(info);
      return {
        port: String(index),
        device: `串口 ${index + 1} · ${description}`,
        description,
        manufacturer,
        hwid:
          info.usbVendorId != null && info.usbProductId != null
            ? `VID_${toHex4(info.usbVendorId)}&PID_${toHex4(info.usbProductId)}`
            : null,
        vendorId: toHex4(info.usbVendorId),
        productId: toHex4(info.usbProductId),
        serialNumber: null,
        is_current: this.port === port,
      };
    } catch (error) {
      if (error instanceof DOMException && error.name === "NotFoundError") {
        throw new Error("已取消串口选择");
      }
      throw error;
    }
  }

  async connect(portId: string, options: SerialOpenOptions): Promise<void> {
    if (!this.isSupported()) {
      throw new Error("Web Serial API is not supported in this environment");
    }
    this.state = "connecting";
    this.errorCode = null;
    this.errorDetail = null;

    const index = Number.parseInt(portId, 10);
    if (Number.isNaN(index)) {
      this.fail("SERIAL_PORT_NOT_FOUND", "串口名称无效");
      throw new Error("串口名称无效");
    }

    const ports = await navigator.serial.getPorts();
    const port = ports[index];
    if (!port) {
      this.fail("SERIAL_PORT_NOT_FOUND", "所选串口不存在，请重新选择串口设备");
      throw new Error("所选串口不存在，请重新选择串口设备");
    }

    try {
      // Web Serial only supports none/even/odd; map mark/space to none.
      const parity: "none" | "even" | "odd" =
        options.parity === "even" || options.parity === "odd"
          ? options.parity
          : "none";
      await port.open({
        baudRate: options.baudRate,
        dataBits: options.dataBits,
        stopBits: options.stopBits,
        parity,
        flowControl: options.flowControl === "hardware" ? "hardware" : undefined,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "串口打开失败";
      const mapped = this.mapOpenError(message);
      this.fail(mapped.code, mapped.message);
      throw new Error(mapped.message);
    }

    this.port = port;
    this.portIndex = index;
    this.baudrate = options.baudRate;
    this.state = "connected";
    this.startReadLoop();
  }

  async disconnect(): Promise<void> {
    await this.stopReadLoop();
    if (this.port) {
      try {
        await this.port.close();
      } catch {
        // Ignore close errors; the port object is being discarded.
      }
    }
    this.port = null;
    this.portIndex = null;
    this.state = "disconnected";
    this.errorCode = null;
    this.errorDetail = null;
  }

  async send(data: Uint8Array): Promise<void> {
    if (!this.port || this.state !== "connected") {
      throw new Error("串口尚未连接");
    }
    const port = this.port;
    const writer = port.writable?.getWriter();
    if (!writer) {
      throw new Error("串口不可写，请重新连接");
    }
    let timedOut = false;
    let failure: Error | null = null;
    const timeoutMessage = "串口写入超时，设备可能未连接或未响应";
    try {
      await withTimeout(
        writer.write(data),
        WRITE_TIMEOUT_MS,
        timeoutMessage,
        () => {
          timedOut = true;
        },
      );
    } catch (error) {
      const isTimeout =
        timedOut ||
        (error instanceof Error &&
          error.name === "OperationTimeoutError");
      failure =
        isTimeout
          ? new Error(timeoutMessage)
          : error instanceof Error
            ? error
            : new Error("串口写入失败");
      if (timedOut) {
        void writer.abort(failure).catch(() => undefined);
      }
    } finally {
      try {
        writer.releaseLock();
      } catch {
        // The stream may still be settling after a timed-out write.
      }
    }

    if (failure) {
      this.handleDisconnect(
        failure,
        timedOut ? "SERIAL_WRITE_TIMEOUT" : "SERIAL_DEVICE_DISCONNECTED",
      );
      void this.stopReadLoop();
      try {
        await withTimeout(
          port.close(),
          CLOSE_TIMEOUT_MS,
          "关闭串口超时",
        );
      } catch {
        // The port may already be closed after the write failure.
      }
      throw failure;
    }
  }

  onData(callback: (data: Uint8Array) => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  getStatus(): SerialStatus {
    const connected = this.state === "connected" && this.port !== null;
    return {
      state: this.state,
      port: connected || this.state === "error" ? this.portLabel() : null,
      device: connected ? this.portLabel() : null,
      baudrate: this.baudrate,
      connected,
      error_code: this.errorCode,
      detail: this.errorDetail,
    };
  }

  private portLabel(): string | null {
    return this.portIndex != null ? `串口 ${this.portIndex + 1}` : null;
  }

  private startReadLoop(): void {
    if (!this.port) return;
    this.readLoopAbort = new AbortController();
    const signal = this.readLoopAbort.signal;

    const loop = async (): Promise<void> => {
      while (this.port && this.port.readable && !signal.aborted) {
        this.reader = this.port.readable.getReader();
        try {
          // eslint-disable-next-line no-constant-condition
          while (true) {
            const { value, done } = await this.reader.read();
            if (done) break;
            if (value) {
              for (const listener of this.listeners) {
                listener(value);
              }
            }
          }
        } catch (error) {
          // Stream closed or errored (e.g. device unplugged).
          if (!signal.aborted) {
            this.handleDisconnect(error);
          }
          break;
        } finally {
          this.reader.releaseLock();
          this.reader = null;
        }
      }
    };
    this.readLoopPromise = loop().finally(() => {
      this.readLoopPromise = null;
    });
  }

  private async stopReadLoop(): Promise<void> {
    this.readLoopAbort?.abort();
    const reader = this.reader;
    if (reader) {
      try {
        await reader.cancel();
      } catch {
        // The stream may already be closed after a device disconnect.
      }
    }
    if (this.readLoopPromise) {
      try {
        await this.readLoopPromise;
      } catch {
        // Read-loop cleanup is best-effort during disconnect.
      }
    }
    this.readLoopAbort = null;
    this.reader = null;
  }

  private handleDisconnect(
    error: unknown,
    errorCode = "SERIAL_DEVICE_DISCONNECTED",
  ): void {
    const message = error instanceof Error ? error.message : "设备已断开";
    this.state = "error";
    this.errorCode = errorCode;
    this.errorDetail = message;
    this.port = null;
    this.portIndex = null;
  }

  private fail(code: string, detail: string): void {
    this.state = "error";
    this.errorCode = code;
    this.errorDetail = detail;
  }

  private mapOpenError(message: string): { code: string; message: string } {
    const lower = message.toLowerCase();
    if (
      lower.includes("busy") ||
      lower.includes("access") ||
      lower.includes("denied") ||
      lower.includes("占用")
    ) {
      return {
        code: "SERIAL_PORT_BUSY",
        message: "串口正在被其他程序占用，请关闭其他串口软件后重试",
      };
    }
    if (lower.includes("not found") || lower.includes("找不到")) {
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
