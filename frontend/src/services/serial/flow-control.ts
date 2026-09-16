import type { FlowControl } from "./types";

export interface NodeFlowControlOptions {
  rtscts: boolean;
  xon: boolean;
  xoff: boolean;
  xany: boolean;
}

export function toNodeFlowControlOptions(
  flowControl: FlowControl | undefined,
): NodeFlowControlOptions {
  if (flowControl === "hardware") {
    return {
      rtscts: true,
      xon: false,
      xoff: false,
      xany: false,
    };
  }
  if (flowControl === "software") {
    return {
      rtscts: false,
      xon: true,
      xoff: true,
      xany: true,
    };
  }
  return {
    rtscts: false,
    xon: false,
    xoff: false,
    xany: false,
  };
}
