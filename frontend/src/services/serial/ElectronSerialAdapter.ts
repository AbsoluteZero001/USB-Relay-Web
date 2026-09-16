import type { SerialAdapter } from "./SerialAdapter";
import type {
  SerialOpenOptions,
  SerialPortInfo,
  SerialStatus,
} from "./types";

/**
 * Electron serial-port adapter.
 *
 * Delegates every serial operation to the Electron main process via the
 * preload-exposed `window.desktopAPI.serial` IPC surface. The renderer
 * never touches Node SerialPort directly.
 */
export class ElectronSerialAdapter implements SerialAdapter {
  readonly name = "ElectronSerial";

  private cachedStatus: SerialStatus = {
    state: "disconnected",
    port: null,
    device: null,
    baudrate: 9600,
    connected: false,
    error_code: null,
    detail: null,
  };

  private statusListeners = new Set<(status: SerialStatus) => void>();
  private dataListeners = new Set<(data: Uint8Array) => void>();
  private unsubStatus: (() => void) | null = null;
  private unsubData: (() => void) | null = null;

  isSupported(): boolean {
    return typeof window !== "undefined" && !!window.desktopAPI?.serial;
  }

  async listPorts(): Promise<SerialPortInfo[]> {
    return this.api.listPorts();
  }

  async connect(portId: string, options: SerialOpenOptions): Promise<void> {
    this.cachedStatus = await this.api.connect(portId, options);
  }

  async disconnect(): Promise<void> {
    await this.api.disconnect();
    this.cachedStatus = await this.api.getStatus();
  }

  async send(data: Uint8Array): Promise<void> {
    try {
      await this.api.send(Array.from(data));
    } catch (error) {
      try {
        this.cachedStatus = await this.api.getStatus();
      } catch {
        // Preserve the original write error if the status refresh fails.
      }
      throw error;
    }
  }

  onData(callback: (data: Uint8Array) => void): () => void {
    this.dataListeners.add(callback);
    if (!this.unsubData && this.isSupported()) {
      this.unsubData = this.api.onData((raw) => {
        const bytes = new Uint8Array(raw);
        for (const listener of this.dataListeners) {
          listener(bytes);
        }
      });
    }
    return () => {
      this.dataListeners.delete(callback);
      if (this.dataListeners.size === 0 && this.unsubData) {
        this.unsubData();
        this.unsubData = null;
      }
    };
  }

  getStatus(): SerialStatus {
    return this.cachedStatus;
  }

  /** Subscribe to status-change events pushed by the main process. */
  onStatusChange(callback: (status: SerialStatus) => void): () => void {
    this.statusListeners.add(callback);
    if (!this.unsubStatus && this.isSupported()) {
      this.unsubStatus = this.api.onStatusChange((status) => {
        this.cachedStatus = status;
        for (const listener of this.statusListeners) {
          listener(status);
        }
      });
    }
    return () => {
      this.statusListeners.delete(callback);
      if (this.statusListeners.size === 0 && this.unsubStatus) {
        this.unsubStatus();
        this.unsubStatus = null;
      }
    };
  }

  private get api() {
    const serial = window.desktopAPI?.serial;
    if (!serial) {
      throw new Error("Electron serial API is not available");
    }
    return serial;
  }
}
