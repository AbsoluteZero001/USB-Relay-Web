import { describe, expect, it } from "vitest";

import {
  DEFAULT_DEVICE_RULES,
  findMatchingPort,
} from "./device-rules";
import type { SerialPortInfo } from "./serial/types";

function port(overrides: Partial<SerialPortInfo>): SerialPortInfo {
  return {
    port: "COM6",
    device: "COM6",
    description: "USB Serial Device",
    manufacturer: null,
    hwid: null,
    vendorId: null,
    productId: null,
    serialNumber: null,
    is_current: false,
    ...overrides,
  };
}

describe("findMatchingPort", () => {
  it("matches a CH340 relay port", () => {
    const relay = port({
      port: "COM8",
      description: "USB-SERIAL CH340",
      manufacturer: "QinHeng Electronics",
      vendorId: "1A86",
      productId: "7523",
    });

    expect(findMatchingPort([relay], DEFAULT_DEVICE_RULES)?.port).toEqual(
      relay,
    );
  });

  it("ignores unrelated or stale serial ports", () => {
    const unrelated = port({
      description: "Bluetooth Serial Port",
      vendorId: "0001",
      productId: "0002",
    });
    const staleWithoutHardwareId = port({ port: "COM7" });

    expect(
      findMatchingPort(
        [unrelated, staleWithoutHardwareId],
        DEFAULT_DEVICE_RULES,
      ),
    ).toBeNull();
  });
});
