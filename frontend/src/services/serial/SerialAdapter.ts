import type {
  SerialOpenOptions,
  SerialPortInfo,
  SerialStatus,
} from "./types";

/**
 * Unified serial-port abstraction.
 *
 * The business layer (RelayService) depends only on this interface so that
 * the Web (Web Serial API) and Electron (Node SerialPort via IPC)
 * implementations can be swapped without touching UI code.
 */
export interface SerialAdapter {
  /** Human-readable adapter name, e.g. "WebSerial" or "ElectronSerial". */
  readonly name: string;

  /** Whether the adapter is available in the current runtime. */
  isSupported(): boolean;

  /** List available serial ports. */
  listPorts(): Promise<SerialPortInfo[]>;

  /**
   * Open a serial port. The port identifier comes from listPorts().
   * On success the adapter transitions to "connected".
   */
  connect(portId: string, options: SerialOpenOptions): Promise<void>;

  /** Close the currently open port. No-op if already disconnected. */
  disconnect(): Promise<void>;

  /** Send raw bytes to the open port. */
  send(data: Uint8Array): Promise<void>;

  /** Register a listener for incoming serial data. */
  onData(callback: (data: Uint8Array) => void): () => void;

  /** Return the current connection status. */
  getStatus(): SerialStatus;
}

/**
 * Optional extension for adapters that require explicit user permission
 * before a port can be enumerated (e.g. Web Serial API's requestPort).
 */
export interface RequestableSerialAdapter extends SerialAdapter {
  /**
   * Ask the user to grant access to a serial port. Returns the info of
   * the newly granted port.
   */
  requestPort(): Promise<SerialPortInfo>;
}

/** Type guard to check whether an adapter supports requestPort. */
export function isRequestable(
  adapter: SerialAdapter,
): adapter is RequestableSerialAdapter {
  return typeof (adapter as RequestableSerialAdapter).requestPort === "function";
}
