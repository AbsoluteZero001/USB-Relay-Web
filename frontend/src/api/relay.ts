// Public API surface for relay control.
//
// This module is a thin façade over RelayService. It keeps the original
// function signatures so that existing Vue components don't need changes.
// The underlying serial transport is selected automatically:
//   - Electron → Node SerialPort (via IPC)
//   - Browser  → Web Serial API

import { appServices } from "../services";
import type {
  HealthResponse,
  RelayActionResponse,
  RelayStatus,
} from "../services/RelayService";
import { getApiErrorMessage } from "../services/errors";
import type {
  SerialConnectionState,
  SerialPortInfo,
  SerialStatus,
} from "../services/serial/types";
import type { AppConfig } from "../services/config/types";

export { getApiErrorMessage };

// Re-export types so existing imports keep working.
export type {
  RelayState,
  RelayStateSource,
  RelayStatus,
  RelayActionResponse,
  HealthResponse,
} from "../services/RelayService";
export type {
  SerialConnectionState,
  SerialPortInfo,
  SerialStatus,
} from "../services/serial/types";
export type { AppConfig } from "../services/config/types";

const relayService = appServices.relay;

/** Initialize services (load config, set up auto-reconnect). Call once at startup. */
export async function initApp(): Promise<void> {
  await appServices.init();
}

export function getAppConfig(): AppConfig {
  return JSON.parse(JSON.stringify(appServices.getConfig())) as AppConfig;
}

export async function updateAppConfig(config: AppConfig): Promise<void> {
  const plainConfig = JSON.parse(JSON.stringify(config)) as AppConfig;
  await appServices.updateConfig(plainConfig);
}

export function isWebSerialSupported(): boolean {
  return relayService.isSupported();
}

export async function listSerialPorts(): Promise<SerialPortInfo[]> {
  return relayService.listPorts();
}

export async function requestSerialPort(): Promise<SerialPortInfo> {
  return relayService.requestPort();
}

export async function connectRelay(port: string): Promise<RelayStatus> {
  return relayService.connect(port);
}

export async function disconnectRelay(): Promise<RelayStatus> {
  return relayService.disconnect();
}

export async function turnRelayOn(): Promise<RelayActionResponse> {
  return relayService.on();
}

export async function turnRelayOff(): Promise<RelayActionResponse> {
  return relayService.off();
}

export async function getRelayStatus(): Promise<RelayStatus> {
  return relayService.getRelayStatus();
}

export async function getSerialStatus(): Promise<SerialStatus> {
  return relayService.getSerialStatus();
}

export async function getHealth(): Promise<HealthResponse> {
  return relayService.getHealth();
}
