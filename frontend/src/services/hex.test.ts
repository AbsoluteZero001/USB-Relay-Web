import { describe, expect, it } from "vitest";

import {
  formatHexBytes,
  HexValidationError,
  parseHexBytes,
} from "./hex";

describe("HEX parsing", () => {
  it("parses and normalizes uppercase HEX", () => {
    const bytes = parseHexBytes("A0 01 01 A2");
    expect(bytes).toEqual([0xa0, 0x01, 0x01, 0xa2]);
    expect(formatHexBytes(bytes)).toBe("A0 01 01 A2");
  });

  it("accepts lowercase and extra whitespace", () => {
    expect(parseHexBytes("a0  01  01  a2")).toEqual([
      0xa0,
      0x01,
      0x01,
      0xa2,
    ]);
  });

  it("rejects an incomplete byte", () => {
    expect(() => parseHexBytes("A0 01 1")).toThrow(HexValidationError);
  });

  it("rejects invalid characters", () => {
    expect(() => parseHexBytes("GG 01 01 A2")).toThrow(
      "HEX 指令包含非法字符：G",
    );
  });

  it("rejects an empty command", () => {
    expect(() => parseHexBytes("  ")).toThrow("HEX 指令不能为空");
  });
});
