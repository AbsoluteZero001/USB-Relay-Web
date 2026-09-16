import type { SerialOpenOptions, SerialPortInfo, SerialStatus } from "./services/serial/types";
import type { AppConfig } from "./services/config/types";

/**
 * Type declarations for the Electron preload bridge (window.desktopAPI).
 * Renderer code only sees this safe surface; Node internals stay hidden.
 */
export interface DesktopVersions {
  electron: string;
  chrome: string;
  node: string;
}

export interface DesktopSerialAPI {
  listPorts(): Promise<SerialPortInfo[]>;
  connect(portId: string, options: SerialOpenOptions): Promise<SerialStatus>;
  disconnect(): Promise<void>;
  send(data: number[]): Promise<void>;
  getStatus(): Promise<SerialStatus>;
  onData(callback: (data: number[]) => void): () => void;
  onStatusChange(callback: (status: SerialStatus) => void): () => void;
}

export interface DesktopConfigAPI {
  load(): Promise<AppConfig>;
  save(config: AppConfig): Promise<void>;
}

export interface DesktopAPI {
  platform: string;
  versions: DesktopVersions;
  isElectron: true;
  serial: DesktopSerialAPI;
  config: DesktopConfigAPI;
}

declare global {
  interface Window {
    desktopAPI?: DesktopAPI;
  }
}
