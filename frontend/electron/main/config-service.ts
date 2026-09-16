import { app } from "electron";
import Store from "electron-store";
import type { AppConfig } from "../../src/services/config/types";
import { DEFAULT_CONFIG } from "../../src/services/config/types";

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
  // Merge with defaults to handle missing keys after version upgrades.
  const saved = store.store;
  return {
    ...DEFAULT_CONFIG,
    ...saved,
    relay: {
      ...DEFAULT_CONFIG.relay,
      ...saved.relay,
      serial: {
        ...DEFAULT_CONFIG.relay.serial,
        ...saved.relay?.serial,
      },
    },
    deviceRules:
      saved.deviceRules?.length > 0
        ? saved.deviceRules
        : DEFAULT_CONFIG.deviceRules,
  };
}

export function saveConfig(config: AppConfig): void {
  store.set(config);
}

export function getConfigPath(): string {
  return store.path;
}

// Expose config path for debugging / user reference.
app.whenReady().then(() => {
  // eslint-disable-next-line no-console
  console.log(`[config] stored at: ${store.path}`);
});
