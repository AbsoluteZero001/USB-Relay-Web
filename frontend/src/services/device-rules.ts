// Device matching rules for auto-detecting USB-serial relay devices.

import type { SerialPortInfo } from "./serial/types";

export interface DeviceMatchRule {
  /** Human-readable device name, e.g. "CH340 Relay". */
  name: string;
  /** USB vendor id (4-digit hex, case-insensitive), e.g. "1A86". */
  vendorId?: string;
  /** USB product id (4-digit hex, case-insensitive), e.g. "7523". */
  productId?: string;
  /** Optional manufacturer substring match. */
  manufacturer?: string;
  /** Optional description substring match. */
  description?: string;
}

/** Built-in known relay devices. Not exhaustive — users can add their own. */
export const DEFAULT_DEVICE_RULES: DeviceMatchRule[] = [
  {
    name: "CH340 Relay (LCUS-1)",
    vendorId: "1A86",
    productId: "7523",
    description: "CH340",
  },
  {
    name: "CH340 Serial",
    vendorId: "1A86",
  },
];

function normalizeHex(value: string | null | undefined): string | null {
  if (!value) return null;
  return value.replace(/^0x/i, "").toUpperCase().padStart(4, "0");
}

function matchRule(port: SerialPortInfo, rule: DeviceMatchRule): boolean {
  if (rule.vendorId) {
    const vid = normalizeHex(port.vendorId);
    const ruleVid = normalizeHex(rule.vendorId);
    if (!vid || vid !== ruleVid) return false;
  }
  if (rule.productId) {
    const pid = normalizeHex(port.productId);
    const rulePid = normalizeHex(rule.productId);
    if (!pid || pid !== rulePid) return false;
  }
  if (rule.manufacturer) {
    if (!port.manufacturer?.toLowerCase().includes(rule.manufacturer.toLowerCase())) {
      return false;
    }
  }
  if (rule.description) {
    if (!port.description?.toLowerCase().includes(rule.description.toLowerCase())) {
      return false;
    }
  }
  return true;
}

/**
 * Find the first port that matches any of the given rules.
 * Returns null if no port matches.
 */
export function findMatchingPort(
  ports: SerialPortInfo[],
  rules: DeviceMatchRule[],
): { port: SerialPortInfo; rule: DeviceMatchRule } | null {
  for (const rule of rules) {
    const port = ports.find((p) => matchRule(p, rule));
    if (port) return { port, rule };
  }
  return null;
}
