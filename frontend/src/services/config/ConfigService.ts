import type { AppConfig } from "./types";
import { normalizeAppConfig } from "./migrate";

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
      if (!raw) return normalizeAppConfig(null);
      return normalizeAppConfig(JSON.parse(raw));
    } catch {
      return normalizeAppConfig(null);
    }
  }

  private saveToLocalStorage(config: AppConfig): void {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(normalizeAppConfig(config)),
    );
  }
}
