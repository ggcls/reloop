import { afterEach, describe, expect, expectTypeOf, test, vi } from "vitest";
import {
  exponentialBackoff,
  fixedDelay,
  retry,
  type BackoffOptions,
  type Jitter,
  type RetryDelay,
} from "../src/index";

const context = (attempt: number) => ({ attempt, retriesLeft: 0, elapsed: 0 });
const invalidNumbers = [NaN, Infinity, -Infinity, -1, "100", null, true, {}];

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("fixedDelay", () => {
  test.each([0, 0.5, 250])("always returns %s regardless of error and context", (milliseconds) => {
    const delay = fixedDelay(milliseconds);
    for (const attempt of [1, 2, 10, Number.MAX_SAFE_INTEGER]) {
      expect(delay(new Error("task"), context(attempt))).toBe(milliseconds);
    }
  });

  test.each([...invalidNumbers, undefined])("rejects %j at creation", (value) => {
    expect(() => fixedDelay(value as number)).toThrow(
      new RangeError("`delay` must be a finite non-negative number"),
    );
  });
});

describe("exponentialBackoff", () => {
  test.each([undefined, {}])("defaults to 100 ms, factor 2, no cap or jitter (%j)", (options) => {
    const random = vi.spyOn(Math, "random");
    const delay = exponentialBackoff(options);
    expect([1, 2, 3, 4].map((attempt) => delay(null, context(attempt)))).toEqual([
      100, 200, 400, 800,
    ]);
    expect(delay(null, context(20))).toBe(52_428_800);
    expect(random).not.toHaveBeenCalled();
  });

  test("supports a custom base and fractional multiplier", () => {
    const delay = exponentialBackoff({ delay: 40, factor: 1.5 });
    expect([1, 2, 3, 4].map((attempt) => delay(null, context(attempt)))).toEqual([40, 60, 90, 135]);
  });

  test("factor 1 keeps the base constant even at very large attempts", () => {
    const delay = exponentialBackoff({ delay: 12.5, factor: 1 });
    expect(delay(null, context(Number.MAX_SAFE_INTEGER))).toBe(12.5);
  });

  test("caps all attempts once maxDelay is reached", () => {
    const delay = exponentialBackoff({ maxDelay: 250 });
    expect([1, 2, 3, 4].map((attempt) => delay(null, context(attempt)))).toEqual([
      100, 200, 250, 250,
    ]);
    expect(exponentialBackoff({ maxDelay: 50 })(null, context(1))).toBe(50);
  });

  test("none jitter never calls Math.random", () => {
    const random = vi.spyOn(Math, "random");
    expect(exponentialBackoff({ jitter: "none", maxDelay: 250 })(null, context(4))).toBe(250);
    expect(random).not.toHaveBeenCalled();
  });

  test.each([0, 0.5, 1 - Number.EPSILON])(
    "applies full jitter after the cap (random: %s)",
    (random) => {
      vi.spyOn(Math, "random").mockReturnValue(random);
      const delay = exponentialBackoff({ maxDelay: 250, jitter: "full" });
      expect(delay(null, context(1))).toBe(random * 100);
      expect(delay(null, context(4))).toBe(random * 250);
    },
  );

  test.each([0, 0.5, 1 - Number.EPSILON])(
    "applies equal jitter after the cap (random: %s)",
    (random) => {
      vi.spyOn(Math, "random").mockReturnValue(random);
      const delay = exponentialBackoff({ maxDelay: 250, jitter: "equal" });
      expect(delay(null, context(1))).toBe(50 + random * 50);
      expect(delay(null, context(4))).toBe(125 + random * 125);
    },
  );

  test.each(["none", "full", "equal"] as const)(
    "zero base or cap stays zero without overflow (%s)",
    (jitter) => {
      for (const options of [{ delay: 0 }, { maxDelay: 0 }]) {
        const delay = exponentialBackoff({ ...options, jitter });
        expect(delay(null, context(1))).toBe(0);
        expect(delay(null, context(Number.MAX_SAFE_INTEGER))).toBe(0);
      }
    },
  );

  test.each(invalidNumbers)("rejects invalid base %j at creation", (delay) => {
    expect(() => exponentialBackoff({ delay } as BackoffOptions)).toThrow(
      new RangeError("`delay` must be a finite non-negative number"),
    );
  });

  test.each([...invalidNumbers, 0, 0.5])("rejects invalid factor %j at creation", (factor) => {
    expect(() => exponentialBackoff({ factor } as BackoffOptions)).toThrow(
      new RangeError("`factor` must be a finite number greater than or equal to 1"),
    );
  });

  test.each(invalidNumbers.filter((value) => value !== Infinity))(
    "rejects invalid cap %j at creation",
    (maxDelay) => {
      expect(() => exponentialBackoff({ maxDelay } as BackoffOptions)).toThrow(
        new RangeError("`maxDelay` must be a non-negative number or Infinity"),
      );
    },
  );

  test.each(["", "FULL", "random", 0, null, true, {}])(
    "rejects invalid jitter %j at creation",
    (jitter) => {
      expect(() => exponentialBackoff({ jitter } as BackoffOptions)).toThrow(
        new RangeError('`jitter` must be "none", "full", or "equal"'),
      );
    },
  );

  test("accepts Infinity as an explicit cap", () => {
    expect(exponentialBackoff({ maxDelay: Infinity })(null, context(4))).toBe(800);
  });

  test.each([2, Number.MAX_SAFE_INTEGER])(
    "caps multiplication and exponent overflow (attempt: %s)",
    (attempt) => {
      const delay = exponentialBackoff({ delay: Number.MAX_VALUE, factor: 2, maxDelay: 500 });
      expect(delay(null, context(attempt))).toBe(500);
    },
  );

  test.each(["none", "full", "equal"] as const)(
    "rejects uncapped overflow before jitter (%s)",
    (jitter) => {
      const random = vi.spyOn(Math, "random").mockReturnValue(0);
      const delay = exponentialBackoff({ jitter });
      expect(() => delay(null, context(Number.MAX_SAFE_INTEGER))).toThrow(
        new RangeError("Exponential delay overflowed; provide a finite `maxDelay`"),
      );
      expect(random).not.toHaveBeenCalled();
    },
  );
});

describe("strategy composition with retry", () => {
  test.each([
    { name: "fixed", delay: fixedDelay(100), waits: [100, 100, 100] },
    { name: "exponential", delay: exponentialBackoff({ maxDelay: 250 }), waits: [100, 200, 250] },
  ])("waits the selected delays with $name", async ({ delay, waits }) => {
    vi.useFakeTimers();
    const task = vi.fn((attempt: number) => {
      if (attempt < 4) throw new Error("task");
      return "done";
    });
    const result = retry(task, { delay });
    for (const [index, milliseconds] of waits.entries()) {
      await vi.advanceTimersByTimeAsync(milliseconds - 1);
      expect(task).toHaveBeenCalledTimes(index + 1);
      await vi.advanceTimersByTimeAsync(1);
      expect(task).toHaveBeenCalledTimes(index + 2);
    }
    await expect(result).resolves.toBe("done");
    expect(vi.getTimerCount()).toBe(0);
  });

  test("overflow stops retry without creating a timer", async () => {
    vi.useFakeTimers();
    const timer = vi.spyOn(globalThis, "setTimeout");
    const strategy = exponentialBackoff();
    const task = vi.fn(() => {
      throw new Error("task");
    });
    await expect(
      retry(task, {
        delay: (error, ctx) => strategy(error, { ...ctx, attempt: Number.MAX_SAFE_INTEGER }),
      }),
    ).rejects.toThrow(RangeError);
    expect(task).toHaveBeenCalledTimes(1);
    expect(timer).not.toHaveBeenCalled();
  });
});

test("exports strategies and their public option types", () => {
  expectTypeOf(fixedDelay(100)).toEqualTypeOf<RetryDelay>();
  expectTypeOf(exponentialBackoff()).toEqualTypeOf<RetryDelay>();
  expectTypeOf<Jitter>().toEqualTypeOf<"none" | "full" | "equal">();
  expectTypeOf<BackoffOptions>().toEqualTypeOf<{
    delay?: number;
    factor?: number;
    maxDelay?: number;
    jitter?: Jitter;
  }>();
});
