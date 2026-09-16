import { describe, expect, it } from "vitest";

import { DEFAULT_CONFIG } from "./config/types";
import { RelayService } from "./RelayService";
import type { SerialAdapter } from "./serial/SerialAdapter";
import type {
  SerialOpenOptions,
  SerialPortInfo,
  SerialStatus,
} from "./serial/types";

class FakeAdapter implements SerialAdapter {
  readonly name = "Fake";
  readonly writes: number[][] = [];
  private connected = false;

  constructor(private readonly supported = true) {}

  isSupported(): boolean {
    return this.supported;
  }

  async listPorts(): Promise<SerialPortInfo[]> {
    return [];
  }

  async connect(_portId: string, _options: SerialOpenOptions): Promise<void> {
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
  }

  async send(data: Uint8Array): Promise<void> {
    this.writes.push(Array.from(data));
  }

  onData(): () => void {
    return () => undefined;
  }

  getStatus(): SerialStatus {
    return {
      state: this.connected ? "connected" : "disconnected",
      port: this.connected ? "COM3" : null,
      device: this.connected ? "USB-SERIAL CH340" : null,
      baudrate: DEFAULT_CONFIG.relay.serial.baudRate,
      connected: this.connected,
      error_code: null,
      detail: null,
    };
  }
}

describe("RelayService LCUS-1 compatibility", () => {
  it("uses the default ON and OFF commands", async () => {
    const adapter = new FakeAdapter();
    const relay = new RelayService(adapter, DEFAULT_CONFIG.relay);
    await relay.connect("COM3");

    const onResult = await relay.on();
    const offResult = await relay.off();

    expect(onResult.command).toBe("A0 01 01 A2");
    expect(offResult.command).toBe("A0 01 00 A1");
    expect(adapter.writes).toEqual([
      [0xa0, 0x01, 0x01, 0xa2],
      [0xa0, 0x01, 0x00, 0xa1],
    ]);
  });

  it("reports runtime serial support separately from connection state", () => {
    const unsupported = new RelayService(
      new FakeAdapter(false),
      DEFAULT_CONFIG.relay,
    );
    const supported = new RelayService(
      new FakeAdapter(true),
      DEFAULT_CONFIG.relay,
    );

    expect(unsupported.getHealth()).toMatchObject({
      status: "ok",
      serial_connected: false,
      serial_supported: false,
    });
    expect(supported.getHealth().serial_supported).toBe(true);
  });
});
