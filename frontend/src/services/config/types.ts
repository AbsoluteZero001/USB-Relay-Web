import type { SerialOpenOptions } from "../serial/types";
import type { DeviceMatchRule } from "../device-rules";
import { DEFAULT_DEVICE_RULES } from "../device-rules";

export type ProtocolMode = "custom_hex";

export interface RelayConfig {
  protocol: ProtocolMode;
  channels: number;
  currentChannel: number;
  onCommand: number[];
  offCommand: number[];
  serial: SerialOpenOptions;
}

export interface AppConfig {
  /** Last selected serial port. */
  selectedPort: string | null;
  /** Relay protocol and serial-port parameters. */
  relay: RelayConfig;
  /** Device matching rules for auto-detection. */
  deviceRules: DeviceMatchRule[];
  /** Auto-connect to the first matching device on startup. */
  autoConnect: boolean;
  /** Auto-reconnect when the device is unexpectedly disconnected. */
  autoReconnect: boolean;
  /** Delay (ms) before attempting to reconnect. */
  reconnectIntervalMs: number;
}

export const DEFAULT_CONFIG: AppConfig = {
  selectedPort: null,
  relay: {
    protocol: "custom_hex",
    channels: 1,
    currentChannel: 1,
    onCommand: [0xa0, 0x01, 0x01, 0xa2],
    offCommand: [0xa0, 0x01, 0x00, 0xa1],
    serial: {
      baudRate: 9600,
      dataBits: 8,
      stopBits: 1,
      parity: "none",
      flowControl: "none",
    },
  },
  deviceRules: DEFAULT_DEVICE_RULES,
  autoConnect: true,
  autoReconnect: true,
  reconnectIntervalMs: 2000,
};
