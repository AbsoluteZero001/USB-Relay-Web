// Shared serial-port types used by both Web Serial and Electron adapters.

export type SerialConnectionState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "error";

export type Parity = "none" | "even" | "odd" | "mark" | "space";
export type FlowControl = "none" | "software" | "hardware";

export interface SerialOpenOptions {
  baudRate: number;
  dataBits: 5 | 6 | 7 | 8;
  stopBits: 1 | 1.5 | 2;
  parity: Parity;
  flowControl?: FlowControl;
}

export interface SerialPortInfo {
  /** Stable identifier used to connect. COMx on Windows, index on Web. */
  port: string;
  /** Human-readable device label. */
  device: string;
  description: string;
  manufacturer: string | null;
  /** Hardware ID string, e.g. VID_1A86&PID_7523. */
  hwid: string | null;
  /** USB vendor id (4-digit hex), e.g. "1A86". */
  vendorId: string | null;
  /** USB product id (4-digit hex), e.g. "7523". */
  productId: string | null;
  serialNumber: string | null;
  /** True if this port is the currently open one. */
  is_current: boolean;
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
