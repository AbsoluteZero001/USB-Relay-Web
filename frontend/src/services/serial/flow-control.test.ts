import { describe, expect, it } from "vitest";

import { toNodeFlowControlOptions } from "./flow-control";

describe("Node serialport flow control mapping", () => {
  it("maps None to disabled flow control", () => {
    expect(toNodeFlowControlOptions("none")).toEqual({
      rtscts: false,
      xon: false,
      xoff: false,
      xany: false,
    });
  });

  it("maps RTS/CTS to rtscts", () => {
    expect(toNodeFlowControlOptions("hardware")).toEqual({
      rtscts: true,
      xon: false,
      xoff: false,
      xany: false,
    });
  });

  it("maps XON/XOFF to software flow control", () => {
    expect(toNodeFlowControlOptions("software")).toEqual({
      rtscts: false,
      xon: true,
      xoff: true,
      xany: true,
    });
  });
});
