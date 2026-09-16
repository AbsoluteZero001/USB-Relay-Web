import { createSerialAdapter } from "./serial";
import type { SerialAdapter } from "./serial/SerialAdapter";
import type { SerialStatus } from "./serial/types";
import { RelayService } from "./RelayService";
import type { AppConfig } from "./config/types";
import { DEFAULT_CONFIG } from "./config/types";
import { ConfigService } from "./config/ConfigService";
import { findMatchingPort } from "./device-rules";
import { getApiErrorMessage } from "./errors";

export interface ConfigUpdateResult {
  serialReconfigured: boolean;
  serialReconfigureError: string | null;
}

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

  async updateConfig(config: AppConfig): Promise<ConfigUpdateResult> {
    const previousConfig = this.appConfig;
    const serialStatus = this.relay.getSerialStatus();
    const connectedPort = serialStatus.connected
      ? this.relay.getRelayStatus().port
      : null;
    const targetPort = config.selectedPort || connectedPort;
    const serialOptionsChanged =
      !this.serialOptionsEqual(
        previousConfig.relay.serial,
        config.relay.serial,
      );
    const targetPortChanged =
      !!connectedPort &&
      !!config.selectedPort &&
      config.selectedPort !== connectedPort;
    const shouldReconnect =
      serialStatus.connected &&
      !!targetPort &&
      (serialOptionsChanged || targetPortChanged);

    this.appConfig = config;
    this.relay.updateConfig(config.relay);
    await this.config.save(config);

    if (!shouldReconnect || !targetPort) {
      return {
        serialReconfigured: false,
        serialReconfigureError: null,
      };
    }

    try {
      await this.relay.reconnect(targetPort);
      return {
        serialReconfigured: true,
        serialReconfigureError: null,
      };
    } catch (error) {
      return {
        serialReconfigured: false,
        serialReconfigureError: getApiErrorMessage(error),
      };
    }
  }

  private serialOptionsEqual(
    left: AppConfig["relay"]["serial"],
    right: AppConfig["relay"]["serial"],
  ): boolean {
    return (
      left.baudRate === right.baudRate &&
      left.dataBits === right.dataBits &&
      left.stopBits === right.stopBits &&
      left.parity === right.parity &&
      (left.flowControl ?? "none") === (right.flowControl ?? "none")
    );
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
