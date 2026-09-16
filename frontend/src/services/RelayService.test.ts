import { afterEach, describe, expect, it, vi } from "vitest";

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
  readonly connections: Array<{
    portId: string;
    options: SerialOpenOptions;
  }> = [];
  private connected = false;

  constructor(
    private readonly supported = true,
    private readonly hangSend = false,
  ) {}

  isSupported(): boolean {
    return this.supported;
  }

  async listPorts(): Promise<SerialPortInfo[]> {
    return [];
  }

  async connect(portId: string, options: SerialOpenOptions): Promise<void> {
    this.connections.push({ portId, options });
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
  }

  async send(data: Uint8Array): Promise<void> {
    if (this.hangSend) {
      return new Promise<void>(() => undefined);
    }
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
  afterEach(() => {
    vi.useRealTimers();
  });

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

  it("reopens the port with updated serial options", async () => {
    const adapter = new FakeAdapter();
    const relay = new RelayService(adapter, DEFAULT_CONFIG.relay);
    await relay.connect("COM3");

    relay.updateConfig({
      ...DEFAULT_CONFIG.relay,
      serial: {
        ...DEFAULT_CONFIG.relay.serial,
        baudRate: 115200,
      },
    });
    await relay.reconnect("COM3");

    expect(adapter.connections.map(({ portId }) => portId)).toEqual([
      "COM3",
      "COM3",
    ]);
    expect(adapter.connections.map(({ options }) => options.baudRate)).toEqual([
      9600,
      115200,
    ]);
  });

  it("times out a stalled write and releases the connection", async () => {
    vi.useFakeTimers();
    const adapter = new FakeAdapter(true, true);
    const relay = new RelayService(adapter, DEFAULT_CONFIG.relay);
    await relay.connect("COM3");

    const pending = relay.on();
    const rejection = expect(pending).rejects.toMatchObject({
      message: expect.stringContaining("写入超时"),
    });

    await vi.advanceTimersByTimeAsync(6000);

    await rejection;
    expect(relay.getRelayStatus().connected).toBe(false);
  });
});
