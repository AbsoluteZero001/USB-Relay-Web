import { DEFAULT_DEVICE_RULES, type DeviceMatchRule } from "../device-rules";
import { tryParseHexBytes } from "../hex";
import type {
  AppConfig,
  ProtocolMode,
  RelayConfig,
} from "./types";
import { DEFAULT_CONFIG } from "./types";
import type {
  FlowControl,
  Parity,
  SerialOpenOptions,
} from "../serial/types";

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readNumber(
  value: unknown,
  fallback: number,
  allowed?: readonly number[],
): number {
  const numeric =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : Number.NaN;
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  if (allowed && !allowed.includes(numeric)) {
    return fallback;
  }
  return numeric;
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function readString(value: unknown, fallback: string | null): string | null {
  if (typeof value !== "string") {
    return fallback;
  }
  const normalized = value.trim();
  return normalized || fallback;
}

function normalizeParity(value: unknown): Parity {
  const normalized = typeof value === "string" ? value.toLowerCase() : "";
  if (normalized === "even" || normalized === "odd") {
    return normalized;
  }
  if (normalized === "mark" || normalized === "space") {
    return normalized;
  }
  return "none";
}

function normalizeFlowControl(value: unknown): FlowControl {
  const normalized = typeof value === "string" ? value.toLowerCase() : "";
  if (
    normalized === "hardware" ||
    normalized === "rts/cts" ||
    normalized === "rtscts"
  ) {
    return "hardware";
  }
  if (
    normalized === "software" ||
    normalized === "xon/xoff" ||
    normalized === "xonxoff"
  ) {
    return "software";
  }
  return "none";
}

function normalizeSerialOptions(
  relaySource: JsonRecord,
  legacySource: JsonRecord,
): SerialOpenOptions {
  const nested = isRecord(relaySource.serial) ? relaySource.serial : {};
  const source =
    Object.keys(nested).length > 0
      ? { ...legacySource, ...nested }
      : legacySource;
  return {
    baudRate: readNumber(
      source.baudRate,
      DEFAULT_CONFIG.relay.serial.baudRate,
    ),
    dataBits: readNumber(
      source.dataBits,
      DEFAULT_CONFIG.relay.serial.dataBits,
      [5, 6, 7, 8],
    ) as SerialOpenOptions["dataBits"],
    stopBits: readNumber(
      source.stopBits,
      DEFAULT_CONFIG.relay.serial.stopBits,
      [1, 1.5, 2],
    ) as SerialOpenOptions["stopBits"],
    parity: normalizeParity(source.parity),
    flowControl: normalizeFlowControl(source.flowControl),
  };
}

function normalizeProtocol(value: unknown): ProtocolMode {
  return value === "custom_hex" ? value : "custom_hex";
}

function normalizeRelayConfig(
  relaySource: JsonRecord,
  legacySource: JsonRecord,
): RelayConfig {
  const channels = Math.min(
    32,
    Math.max(
      1,
      Math.trunc(
        readNumber(
          relaySource.channels,
          DEFAULT_CONFIG.relay.channels,
        ),
      ),
    ),
  );
  const currentChannel = Math.min(
    channels,
    Math.max(
      1,
      Math.trunc(
        readNumber(
          relaySource.currentChannel,
          DEFAULT_CONFIG.relay.currentChannel,
        ),
      ),
    ),
  );

  const onCommand =
    tryParseHexBytes(
      (relaySource.onCommand ?? legacySource.onCommand) as
        | string
        | number[]
        | undefined,
    ) ?? [...DEFAULT_CONFIG.relay.onCommand];
  const offCommand =
    tryParseHexBytes(
      (relaySource.offCommand ?? legacySource.offCommand) as
        | string
        | number[]
        | undefined,
    ) ?? [...DEFAULT_CONFIG.relay.offCommand];

  return {
    protocol: normalizeProtocol(relaySource.protocol),
    channels,
    currentChannel,
    onCommand,
    offCommand,
    serial: normalizeSerialOptions(relaySource, legacySource),
  };
}

function normalizeDeviceRules(value: unknown): DeviceMatchRule[] {
  return Array.isArray(value) && value.length > 0
    ? (value as DeviceMatchRule[])
    : DEFAULT_DEVICE_RULES;
}

export function normalizeAppConfig(value: unknown): AppConfig {
  const source = isRecord(value) ? value : {};
  const relaySource = isRecord(source.relay) ? source.relay : source;
  const legacySource = source;

  return {
    selectedPort: readString(
      source.selectedPort ?? source.port ?? relaySource.port,
      DEFAULT_CONFIG.selectedPort,
    ),
    relay: normalizeRelayConfig(relaySource, legacySource),
    deviceRules: normalizeDeviceRules(
      source.deviceRules ?? relaySource.deviceRules,
    ),
    autoConnect: readBoolean(
      source.autoConnect,
      DEFAULT_CONFIG.autoConnect,
    ),
    autoReconnect: readBoolean(
      source.autoReconnect,
      DEFAULT_CONFIG.autoReconnect,
    ),
    reconnectIntervalMs: Math.max(
      500,
      readNumber(
        source.reconnectIntervalMs,
        DEFAULT_CONFIG.reconnectIntervalMs,
      ),
    ),
  };
}
