import { afterEach, describe, expect, it, vi } from "vitest";

import {
  OperationTimeoutError,
  withTimeout,
} from "./timeout";

describe("withTimeout", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns a completed operation before the deadline", async () => {
    await expect(
      withTimeout(Promise.resolve("ok"), 100, "timed out"),
    ).resolves.toBe("ok");
  });

  it("rejects and invokes cleanup when the deadline is exceeded", async () => {
    vi.useFakeTimers();
    const onTimeout = vi.fn();
    const pending = withTimeout(
      new Promise<void>(() => undefined),
      1000,
      "串口操作超时",
      onTimeout,
    );
    const rejection = expect(pending).rejects.toBeInstanceOf(
      OperationTimeoutError,
    );

    await vi.advanceTimersByTimeAsync(1000);

    await rejection;
    expect(onTimeout).toHaveBeenCalledOnce();
  });
});
