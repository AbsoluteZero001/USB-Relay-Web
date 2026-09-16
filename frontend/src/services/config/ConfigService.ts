import type { AppConfig } from "./types";
import { DEFAULT_CONFIG } from "./types";

const STORAGE_KEY = "usb-relay-config";

/**
 * Configuration persistence service.
 *
 * - In Electron: delegates to the main process (electron-store) via IPC,
 *   which writes to %APPDATA%/<app-name>/config.json.
 * - In a browser: stores in localStorage.
 */
export class ConfigService {
  private isElectron(): boolean {
    return typeof window !== "undefined" && !!window.desktopAPI?.config;
  }

  async load(): Promise<AppConfig> {
    if (this.isElectron()) {
      return window.desktopAPI!.config.load();
    }
    return this.loadFromLocalStorage();
  }

  async save(config: AppConfig): Promise<void> {
    if (this.isElectron()) {
      await window.desktopAPI!.config.save(config);
      return;
    }
    this.saveToLocalStorage(config);
  }

  private loadFromLocalStorage(): AppConfig {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { ...DEFAULT_CONFIG };
      const parsed = JSON.parse(raw) as Partial<AppConfig>;
      return {
        ...DEFAULT_CONFIG,
        ...parsed,
        relay: {
          ...DEFAULT_CONFIG.relay,
          ...parsed.relay,
          serial: {
            ...DEFAULT_CONFIG.relay.serial,
            ...parsed.relay?.serial,
          },
        },
        deviceRules:
          parsed.deviceRules && parsed.deviceRules.length > 0
            ? parsed.deviceRules
            : DEFAULT_CONFIG.deviceRules,
      };
    } catch {
      return { ...DEFAULT_CONFIG };
    }
  }

  private saveToLocalStorage(config: AppConfig): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  }
}
