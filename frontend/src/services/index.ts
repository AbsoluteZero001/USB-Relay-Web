import { createSerialAdapter } from "./serial";
import type { SerialAdapter } from "./serial/SerialAdapter";
import type { SerialStatus } from "./serial/types";
import { RelayService } from "./RelayService";
import type { AppConfig } from "./config/types";
import { DEFAULT_CONFIG } from "./config/types";
import { ConfigService } from "./config/ConfigService";
import { findMatchingPort } from "./device-rules";

/**
 * Top-level service coordinator.
 *
 * Owns the config service and the relay service, and wires up
 * auto-connect / auto-reconnect behaviour.
 */
class AppServices {
  readonly config = new ConfigService();
  readonly adapter: SerialAdapter = createSerialAdapter();
  readonly relay = new RelayService(this.adapter, DEFAULT_CONFIG.relay);

  private appConfig: AppConfig = DEFAULT_CONFIG;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private statusUnsubscribe: (() => void) | null = null;
  private initialized = false;

  /** Load persisted config, apply it, and set up auto-connect. */
  async init(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;

    this.appConfig = await this.config.load();
    this.relay.updateConfig(this.appConfig.relay);

    // Listen for unexpected disconnects to trigger auto-reconnect.
    if ("onStatusChange" in this.adapter) {
      const adapter = this.adapter as SerialAdapter & {
        onStatusChange(cb: (s: SerialStatus) => void): () => void;
      };
      this.statusUnsubscribe = adapter.onStatusChange((status) => {
        if (
          this.appConfig.autoReconnect &&
          status.state === "error" &&
          status.error_code === "SERIAL_DEVICE_DISCONNECTED"
        ) {
          this.scheduleReconnect();
        }
      });
    }
  }

  getConfig(): AppConfig {
    return this.appConfig;
  }

  async updateConfig(config: AppConfig): Promise<void> {
    this.appConfig = config;
    this.relay.updateConfig(config.relay);
    await this.config.save(config);
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      try {
        const ports = await this.relay.listPorts();
        const match = findMatchingPort(ports, this.appConfig.deviceRules);
        if (match) {
          await this.relay.connect(match.port.port);
        }
      } catch {
        // Will retry on next disconnect event.
      }
    }, this.appConfig.reconnectIntervalMs);
  }
}

export const appServices = new AppServices();
