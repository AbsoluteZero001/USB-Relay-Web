import Store from "electron-store";
import type { AppConfig } from "../../src/services/config/types";
import { DEFAULT_CONFIG } from "../../src/services/config/types";
import { normalizeAppConfig } from "../../src/services/config/migrate";

/**
 * Persistent configuration store for the Electron desktop version.
 *
 * electron-store writes to:
 *   %APPDATA%/<app-name>/config.json
 *
 * It never requires admin privileges and keeps user data out of
 * C:\Program Files.
 */
const store = new Store<AppConfig>({
  name: "config",
  defaults: DEFAULT_CONFIG,
});

export function loadConfig(): AppConfig {
  return normalizeAppConfig(store.store);
}

export function saveConfig(config: AppConfig): void {
  store.set(normalizeAppConfig(config));
}
