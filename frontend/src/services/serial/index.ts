import type { SerialAdapter } from "./SerialAdapter";
import { ElectronSerialAdapter } from "./ElectronSerialAdapter";
import { WebSerialAdapter } from "./WebSerialAdapter";

/**
 * Returns the appropriate serial adapter for the current runtime.
 *
 * - Inside Electron: ElectronSerialAdapter (IPC → Node SerialPort)
 * - In a browser:    WebSerialAdapter (Web Serial API)
 */
export function createSerialAdapter(): SerialAdapter {
  if (typeof window !== "undefined" && window.desktopAPI?.serial) {
    return new ElectronSerialAdapter();
  }
  return new WebSerialAdapter();
}

export type { SerialAdapter, RequestableSerialAdapter } from "./SerialAdapter";
export { isRequestable } from "./SerialAdapter";
export type {
  SerialConnectionState,
  SerialOpenOptions,
  SerialPortInfo,
  SerialStatus,
  Parity,
  FlowControl,
} from "./types";
export { WebSerialAdapter } from "./WebSerialAdapter";
export { ElectronSerialAdapter } from "./ElectronSerialAdapter";
