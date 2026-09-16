import { contextBridge, ipcRenderer } from "electron";
import type { SerialOpenOptions, SerialPortInfo, SerialStatus } from "../../src/services/serial/types";
import type { AppConfig } from "../../src/services/config/types";

/**
 * Safe API exposed to the renderer process via contextBridge.
 *
 * Renderer never gets direct access to Node.js / Electron internals.
 * All serial-port and config operations go through whitelisted IPC channels.
 */
const serialAPI = {
  listPorts: (): Promise<SerialPortInfo[]> =>
    ipcRenderer.invoke("serial:list-ports"),

  connect: (portId: string, options: SerialOpenOptions): Promise<SerialStatus> =>
    ipcRenderer.invoke("serial:connect", portId, options),

  disconnect: (): Promise<void> =>
    ipcRenderer.invoke("serial:disconnect"),

  send: (data: number[]): Promise<void> =>
    ipcRenderer.invoke("serial:send", data),

  getStatus: (): Promise<SerialStatus> =>
    ipcRenderer.invoke("serial:get-status"),

  onData: (callback: (data: number[]) => void): (() => void) => {
    const listener = (_event: unknown, payload: number[]) => callback(payload);
    ipcRenderer.on("serial:data", listener);
    return () => ipcRenderer.removeListener("serial:data", listener);
  },

  onStatusChange: (callback: (status: SerialStatus) => void): (() => void) => {
    const listener = (_event: unknown, status: SerialStatus) =>
      callback(status);
    ipcRenderer.on("serial:status-change", listener);
    return () =>
      ipcRenderer.removeListener("serial:status-change", listener);
  },
};

const configAPI = {
  load: (): Promise<AppConfig> => ipcRenderer.invoke("config:load"),
  save: (config: AppConfig): Promise<void> =>
    ipcRenderer.invoke("config:save", config),
};

contextBridge.exposeInMainWorld("desktopAPI", {
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },
  isElectron: true,
  serial: serialAPI,
  config: configAPI,
});
