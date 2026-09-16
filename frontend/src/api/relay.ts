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
  RelayConfig,
  RelayStatus,
} from "../services/RelayService";
import {
  getApiErrorMessage,
  PortBusyError,
  SerialConnectionError,
  SerialNotConnectedError,
  SerialPortNotFoundError,
  SerialUserCancelledError,
  SerialWriteError,
  ServiceError,
  WebSerialUnsupportedError,
} from "../services/errors";
import type { AuditLogEntry, AuditLogPage } from "../services/AuditLogStore";
import type {
  SerialConnectionState,
  SerialPortInfo,
  SerialStatus,
} from "../services/serial/types";
import type { AppConfig } from "../services/config/types";

// Re-export types so existing imports keep working.
export type {
  RelayState,
  RelayStateSource,
  RelayStatus,
  RelayActionResponse,
  RelayConfig,
  HealthResponse,
} from "../services/RelayService";
export type {
  SerialConnectionState,
  SerialPortInfo,
  SerialStatus,
} from "../services/serial/types";
export type { AuditLogEntry, AuditLogPage } from "../services/AuditLogStore";
export type { AppConfig } from "../services/config/types";

// Re-export error classes.
export {
  ServiceError,
  WebSerialUnsupportedError,
  SerialUserCancelledError,
  SerialPortNotFoundError,
  PortBusyError,
  SerialConnectionError,
  SerialNotConnectedError,
  SerialWriteError,
  getApiErrorMessage,
};

const relayService = appServices.relay;

/** Initialize services (load config, set up auto-reconnect). Call once at startup. */
export async function initApp(): Promise<void> {
  await appServices.init();
}

/** Try to auto-connect to a matching device (if enabled in config). */
export async function tryAutoConnect(): Promise<boolean> {
  return appServices.tryAutoConnect();
}

export function getAppConfig(): AppConfig {
  return appServices.getConfig();
}

export async function updateAppConfig(config: AppConfig): Promise<void> {
  await appServices.updateConfig(config);
}

/** Allow callers (e.g. settings panel) to update the active relay config. */
export function updateRelayConfig(config: RelayConfig): void {
  relayService.updateConfig(config);
}

export function getRelayConfig(): RelayConfig {
  return relayService.getConfig();
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

export async function listAuditLogs(
  limit = 20,
  offset = 0,
): Promise<AuditLogPage> {
  return relayService.listAuditLogs(limit, offset);
}

export async function clearAuditLogs(): Promise<{ deleted: number }> {
  return relayService.clearAuditLogs();
}
