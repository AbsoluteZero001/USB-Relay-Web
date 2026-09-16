import { describe, expect, it } from "vitest";

import { normalizeAppConfig } from "./migrate";

describe("configuration migration", () => {
  it("returns the default serial parameters", () => {
    const config = normalizeAppConfig(null);
    expect(config.relay.serial).toEqual({
      baudRate: 9600,
      dataBits: 8,
      stopBits: 1,
      parity: "none",
      flowControl: "none",
    });
    expect(config.relay.protocol).toBe("custom_hex");
    expect(config.relay.currentChannel).toBe(1);
  });

  it("loads the legacy flat configuration", () => {
    const config = normalizeAppConfig({
      port: "COM3",
      baudRate: 19200,
      onCommand: "a0 01 01 a2",
      offCommand: "A0 01 00 A1",
      autoConnect: true,
      autoReconnect: true,
    });

    expect(config.selectedPort).toBe("COM3");
    expect(config.relay.serial.baudRate).toBe(19200);
    expect(config.relay.serial.dataBits).toBe(8);
    expect(config.relay.serial.parity).toBe("none");
    expect(config.relay.serial.stopBits).toBe(1);
    expect(config.relay.serial.flowControl).toBe("none");
    expect(config.relay.onCommand).toEqual([0xa0, 0x01, 0x01, 0xa2]);
    expect(config.relay.offCommand).toEqual([0xa0, 0x01, 0x00, 0xa1]);
  });

  it("fills missing new fields in the current nested format", () => {
    const config = normalizeAppConfig({
      relay: {
        onCommand: [0xa0, 0x01, 0x01, 0xa2],
        offCommand: [0xa0, 0x01, 0x00, 0xa1],
        serial: {
          baudRate: 57600,
        },
      },
    });

    expect(config.relay.serial.baudRate).toBe(57600);
    expect(config.relay.serial.dataBits).toBe(8);
    expect(config.relay.serial.stopBits).toBe(1);
    expect(config.relay.serial.parity).toBe("none");
    expect(config.relay.serial.flowControl).toBe("none");
  });
});
