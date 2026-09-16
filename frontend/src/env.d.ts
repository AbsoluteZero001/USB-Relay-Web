/// <reference types="vite/client" />

// Web Serial API (Chromium 89+). Not included in default TS DOM lib.
interface SerialPortUsbInfo {
  usbVendorId?: number;
  usbProductId?: number;
}

interface SerialOptions {
  baudRate: number;
  dataBits?: number;
  stopBits?: number;
  parity?: "none" | "even" | "odd";
  bufferSize?: number;
  flowControl?: "none" | "hardware";
}

interface SerialPort {
  readonly readable: ReadableStream<Uint8Array> | null;
  readonly writable: WritableStream<Uint8Array> | null;
  open(options: SerialOptions): Promise<void>;
  close(): Promise<void>;
  getInfo(): SerialPortUsbInfo;
  addEventListener(
    type: "connect" | "disconnect",
    listener: (event: Event) => void,
  ): void;
  removeEventListener(
    type: "connect" | "disconnect",
    listener: (event: Event) => void,
  ): void;
}

interface SerialPortRequestOptions {
  filters?: Array<{ usbVendorId?: number; usbProductId?: number }>;
}

interface Serial {
  getPorts(): Promise<SerialPort[]>;
  requestPort(options?: SerialPortRequestOptions): Promise<SerialPort>;
  addEventListener(
    type: "connect" | "disconnect",
    listener: (event: Event) => void,
  ): void;
  removeEventListener(
    type: "connect" | "disconnect",
    listener: (event: Event) => void,
  ): void;
}

interface Navigator {
  readonly serial: Serial;
}
