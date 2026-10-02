import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { retry, type RetryDelay, type RetryOptions } from "../src/index";

describe("retry", () => {
  test("returns a synchronous value on the first attempt unchanged", async () => {
    const value = { ok: true };
    const task = vi.fn(() => value);

    await expect(retry(task)).resolves.toBe(value);
    expect(task).toHaveBeenCalledExactlyOnceWith(1);
  });

  test("returns an asynchronous value on the first attempt unchanged", async () => {
    const value = { ok: true };
    const task = vi.fn(async () => value);

    await expect(retry(task)).resolves.toBe(value);
    expect(task).toHaveBeenCalledExactlyOnceWith(1);
  });

  test("retries a synchronous throw and succeeds after one retry", async () => {
    const task = vi.fn((attempt: number) => {
      if (attempt === 1) {
        throw new Error("failed");
      }
      return "done";
    });

    await expect(retry(task, { retries: 1 })).resolves.toBe("done");
    expect(task.mock.calls).toEqual([[1], [2]]);
  });

  test("retries rejected promises and succeeds after several retries", async () => {
    const task = vi.fn((attempt: number) =>
      attempt < 4 ? Promise.reject(new Error("failed")) : Promise.resolve("done"),
    );

    await expect(retry(task, { retries: 3 })).resolves.toBe("done");
    expect(task.mock.calls).toEqual([[1], [2], [3], [4]]);
  });

  test("preserves the exact final error after different failures", async () => {
    const firstError = new Error("first");
    const finalError = new Error("final");
    const task = vi.fn((attempt: number) => {
      throw attempt === 1 ? firstError : finalError;
    });

    await expect(retry(task, { retries: 1 })).rejects.toBe(finalError);
    expect(task).toHaveBeenCalledTimes(2);
  });

  test.each([0, 1, 2, 5])("allows exactly %i additional attempts", async (retries) => {
    const error = new Error("failed");
    const task = vi.fn(() => Promise.reject(error));

    await expect(retry(task, { retries })).rejects.toBe(error);
    expect(task).toHaveBeenCalledTimes(retries + 1);
    expect(task.mock.calls).toEqual(Array.from({ length: retries + 1 }, (_, i) => [i + 1]));
  });

  test("does not retry a synchronous failure with retries: 0", async () => {
    const error = new Error("failed");
    const task = vi.fn(() => {
      throw error;
    });

    await expect(retry(task, { retries: 0 })).rejects.toBe(error);
    expect(task).toHaveBeenCalledExactlyOnceWith(1);
  });

  test.each([undefined, {}])("defaults to three retries with options %j", async (options) => {
    const error = new Error("failed");
    const task = vi.fn(() => {
      throw error;
    });

    await expect(retry(task, options)).rejects.toBe(error);
    expect(task.mock.calls).toEqual([[1], [2], [3], [4]]);
  });

  test.each([-1, -0.5, 0.5, NaN, Infinity, -Infinity, "3", null, true])(
    "rejects invalid retries %j before calling the task",
    async (retries) => {
      const task = vi.fn(() => "done");
      const options = { retries } as RetryOptions;

      await expect(retry(task, options)).rejects.toThrow(
        new RangeError("`retries` must be a non-negative integer"),
      );
      expect(task).not.toHaveBeenCalled();
    },
  );

  test("does not create timers between attempts", async () => {
    const timer = vi.spyOn(globalThis, "setTimeout");
    try {
      await expect(
        retry((attempt) => {
          if (attempt < 3) {
            throw new Error("failed");
          }
          return attempt;
        }),
      ).resolves.toBe(3);
      expect(timer).not.toHaveBeenCalled();
    } finally {
      timer.mockRestore();
    }
  });
});

describe("delays and cancellation", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date", "performance"] });
    vi.setSystemTime(0);
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const failingTask = () =>
    vi.fn((attempt: number) => {
      if (attempt < 3) {
        throw new Error("failed");
      }
      return "done";
    });

  test("waits the numeric delay between every retry", async () => {
    const task = failingTask();
    const result = retry(task, { delay: 100 });
    const assertion = expect(result).resolves.toBe("done");

    expect(task).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(99);
    expect(task).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(task).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(99);
    expect(task).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    await assertion;
    expect(task.mock.calls).toEqual([[1], [2], [3]]);
    expect(vi.getTimerCount()).toBe(0);
  });

  test("passes the original error and available context to a delay callback", async () => {
    const error = new Error("failed");
    const task = vi.fn((attempt: number) => {
      if (attempt < 3) {
        throw error;
      }
      return "done";
    });
    const strategy: RetryDelay = (_error, context) => context.attempt * 100;
    const delay = vi.fn(strategy);
    const result = retry(task, { retries: 3, delay });
    const assertion = expect(result).resolves.toBe("done");

    await vi.advanceTimersByTimeAsync(0);
    expect(delay).toHaveBeenNthCalledWith(1, error, {
      attempt: 1,
      retriesLeft: 2,
      elapsed: 0,
    });
    await vi.advanceTimersByTimeAsync(100);
    expect(delay).toHaveBeenNthCalledWith(2, error, {
      attempt: 2,
      retriesLeft: 1,
      elapsed: 100,
    });
    await vi.advanceTimersByTimeAsync(199);
    expect(task).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    await assertion;
  });

  test("supports asynchronous delay callbacks", async () => {
    const task = failingTask();
    const delay = vi.fn(async () => 100);
    const assertion = expect(retry(task, { delay })).resolves.toBe("done");
    await vi.runAllTimersAsync();
    await assertion;
    expect(delay).toHaveBeenCalledTimes(2);
    expect(task).toHaveBeenCalledTimes(3);
  });

  test("does not compute a delay or wait after the final failure", async () => {
    const error = new Error("failed");
    const task = vi.fn(() => {
      throw error;
    });
    const delay = vi.fn(() => 100);
    const assertion = expect(retry(task, { retries: 1, delay })).rejects.toBe(error);
    await vi.runAllTimersAsync();
    await assertion;
    expect(delay).toHaveBeenCalledTimes(1);
    expect(task).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  test.each([0, () => 0, async () => 0])(
    "does not create timers for zero delay %s",
    async (delay) => {
      const timer = vi.spyOn(globalThis, "setTimeout");
      await expect(retry(failingTask(), { delay })).resolves.toBe("done");
      expect(timer).not.toHaveBeenCalled();
    },
  );

  const invalidDelays = [-1, NaN, Infinity, -Infinity, "100", null, true, {}, undefined];

  test.each(invalidDelays.filter((value) => value !== undefined))(
    "rejects invalid delay option %j before calling the task",
    async (delay) => {
      const task = vi.fn(() => "done");
      await expect(retry(task, { delay } as RetryOptions)).rejects.toThrow(
        new RangeError("`delay` must be a finite non-negative number"),
      );
      expect(task).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  test.each(invalidDelays)("rejects invalid callback delay %j", async (value) => {
    const task = failingTask();
    const delay = (async () => value) as RetryDelay;
    await expect(retry(task, { delay })).rejects.toThrow(
      new RangeError("`delay` must be a finite non-negative number"),
    );
    expect(task).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  test.each([false, true])("preserves delay callback errors (async: %s)", async (asynchronous) => {
    const error = new Error("delay failed");
    const fail = () => {
      throw error;
    };
    const delay = asynchronous ? async () => fail() : fail;
    const task = failingTask();
    await expect(retry(task, { delay })).rejects.toBe(error);
    expect(task).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  test.each([new Error("cancelled"), { cancelled: true }, "cancelled"])(
    "does not start a task with a pre-aborted signal and preserves reason %s",
    async (reason) => {
      const controller = new AbortController();
      controller.abort(reason);
      const task = vi.fn(() => "done");
      await expect(retry(task, { signal: controller.signal })).rejects.toBe(reason);
      expect(task).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  test("removes the listener after a delay resolves with a non-aborted signal", async () => {
    const controller = new AbortController();
    const add = vi.spyOn(controller.signal, "addEventListener");
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    const task = failingTask();
    const assertion = expect(retry(task, { delay: 100, signal: controller.signal })).resolves.toBe(
      "done",
    );
    await vi.runAllTimersAsync();
    await assertion;
    expect(remove.mock.calls).toEqual(add.mock.calls.map(([event, listener]) => [event, listener]));
    expect(remove).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  test("abort clears the delay, removes its listener, and prevents another attempt", async () => {
    const controller = new AbortController();
    const reason = new Error("cancelled");
    const add = vi.spyOn(controller.signal, "addEventListener");
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    const task = failingTask();
    const assertion = expect(retry(task, { delay: 100, signal: controller.signal })).rejects.toBe(
      reason,
    );
    await vi.advanceTimersByTimeAsync(50);
    expect(vi.getTimerCount()).toBe(1);
    controller.abort(reason);
    await assertion;
    expect(vi.getTimerCount()).toBe(0);
    expect(remove).toHaveBeenCalledExactlyOnceWith("abort", add.mock.calls[0]![1]);
    await vi.runAllTimersAsync();
    expect(task).toHaveBeenCalledTimes(1);
  });

  test("observes an abort during timer setup", async () => {
    const controller = new AbortController();
    const reason = new Error("cancelled");
    const add = controller.signal.addEventListener.bind(controller.signal);
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    vi.spyOn(controller.signal, "addEventListener").mockImplementation((...args) => {
      controller.abort(reason);
      add(...args);
    });
    const task = failingTask();
    await expect(retry(task, { delay: 100, signal: controller.signal })).rejects.toBe(reason);
    expect(remove).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    expect(task).toHaveBeenCalledTimes(1);
  });

  test("abort during a delay callback prevents a timer and another attempt", async () => {
    const controller = new AbortController();
    const reason = new Error("cancelled");
    const task = failingTask();
    await expect(
      retry(task, {
        signal: controller.signal,
        delay: async () => {
          controller.abort(reason);
          return 100;
        },
      }),
    ).rejects.toBe(reason);
    expect(task).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  test("checks the signal before starting a zero-delay retry", async () => {
    const controller = new AbortController();
    const reason = new Error("cancelled");
    const task = failingTask();
    const result = retry(task, { signal: controller.signal, delay: 0 });
    controller.abort(reason);
    await expect(result).rejects.toBe(reason);
    expect(task).toHaveBeenCalledTimes(1);
  });

  test("abort in a failed task prevents invoking the delay callback", async () => {
    const controller = new AbortController();
    const reason = new Error("cancelled");
    const delay = vi.fn(() => 100);
    await expect(
      retry(
        () => {
          controller.abort(reason);
          throw new Error("failed");
        },
        { signal: controller.signal, delay },
      ),
    ).rejects.toBe(reason);
    expect(delay).not.toHaveBeenCalled();
  });

  test("preserves the final task failure even when that task aborts the signal", async () => {
    const controller = new AbortController();
    const error = new Error("failed");
    await expect(
      retry(
        () => {
          controller.abort();
          throw error;
        },
        { retries: 0, signal: controller.signal },
      ),
    ).rejects.toBe(error);
  });

  test("does not forcibly cancel an active task", async () => {
    const controller = new AbortController();
    let complete!: (value: string) => void;
    const task = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          complete = resolve;
        }),
    );
    const result = retry(task, { signal: controller.signal });
    let settled = false;
    void result.then(() => {
      settled = true;
    });
    controller.abort();
    await Promise.resolve();
    expect(settled).toBe(false);
    complete("done");
    await expect(result).resolves.toBe("done");
    expect(task).toHaveBeenCalledTimes(1);
  });
});

describe("retry decisions and hooks", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date", "performance"] });
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  test.each([false, true])(
    "accepts retries with sync and async hooks (async: %s)",
    async (asyncHook) => {
      const error = new Error("task");
      const task = vi.fn((attempt: number) => {
        if (attempt < 4) throw error;
        return "done";
      });
      const shouldRetry = vi.fn(() => (asyncHook ? Promise.resolve(true) : true));
      const onRetry = vi.fn(() => (asyncHook ? Promise.resolve() : undefined));
      await expect(retry(task, { shouldRetry, onRetry })).resolves.toBe("done");
      expect(task.mock.calls).toEqual([[1], [2], [3], [4]]);
      for (const callback of [shouldRetry, onRetry]) {
        expect(callback).toHaveBeenCalledTimes(3);
        for (let attempt = 1; attempt <= 3; attempt++) {
          expect(callback).toHaveBeenNthCalledWith(attempt, error, {
            attempt,
            retriesLeft: 3 - attempt,
            delay: 0,
            elapsed: 0,
          });
        }
      }
    },
  );

  test.each([false, true])(
    "declining preserves the task error and skips delay and onRetry (async: %s)",
    async (asyncHook) => {
      const error = new Error("task");
      const task = vi.fn(() => {
        throw error;
      });
      const delay = vi.fn(() => 100);
      const onRetry = vi.fn();
      const shouldRetry = vi.fn(() => (asyncHook ? Promise.resolve(false) : false));
      await expect(retry(task, { shouldRetry, delay, onRetry })).rejects.toBe(error);
      expect(shouldRetry).toHaveBeenCalledExactlyOnceWith(error, {
        attempt: 1,
        retriesLeft: 2,
        delay: 0,
        elapsed: 0,
      });
      expect(task).toHaveBeenCalledTimes(1);
      expect(delay).not.toHaveBeenCalled();
      expect(onRetry).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  test.each([0, 1, 3])("skips hooks after the final failure with %i retries", async (retries) => {
    const error = new Error("task");
    const task = vi.fn(() => {
      throw error;
    });
    const shouldRetry = vi.fn(() => true);
    const onRetry = vi.fn();
    await expect(retry(task, { retries, shouldRetry, onRetry })).rejects.toBe(error);
    expect(shouldRetry).toHaveBeenCalledTimes(retries);
    expect(onRetry).toHaveBeenCalledTimes(retries);
    expect(task).toHaveBeenCalledTimes(retries + 1);
  });

  test.each(["shouldRetry", "onRetry"] as const)(
    "preserves sync and async errors from %s without waiting",
    async (hook) => {
      for (const asyncHook of [false, true]) {
        const callbackError = new Error("hook");
        const task = vi.fn(() => {
          throw new Error("task");
        });
        const timer = vi.spyOn(globalThis, "setTimeout");
        const delay = vi.fn(() => 100);
        const onRetry = vi.fn();
        const fail = () => {
          if (asyncHook) return Promise.reject(callbackError);
          throw callbackError;
        };
        await expect(retry(task, { delay, onRetry, [hook]: fail })).rejects.toBe(callbackError);
        expect(task).toHaveBeenCalledTimes(1);
        expect(delay).toHaveBeenCalledTimes(hook === "shouldRetry" ? 0 : 1);
        expect(onRetry).not.toHaveBeenCalled();
        expect(timer).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
      }
    },
  );

  test("orders callbacks before waiting and shares a coherent failure snapshot", async () => {
    const events: string[] = [];
    const error = new Error("task");
    const shouldRetry = vi.fn<NonNullable<RetryOptions["shouldRetry"]>>(async (_error, context) => {
      events.push(`shouldRetry:${context.attempt}`);
      await Promise.resolve();
      return true;
    });
    const delay = vi.fn<RetryDelay>(async (_error, context) => {
      events.push(`delay:${context.attempt}`);
      return context.attempt * 100;
    });
    const onRetry = vi.fn<NonNullable<RetryOptions["onRetry"]>>(async (_error, context) => {
      events.push(`onRetry:${context.attempt}`);
      await Promise.resolve();
    });
    const result = retry(
      (attempt) => {
        events.push(`task:${attempt}`);
        if (attempt < 3) throw error;
        return "done";
      },
      { shouldRetry, delay, onRetry },
    );
    const assertion = expect(result).resolves.toBe("done");
    await vi.advanceTimersByTimeAsync(0);
    expect(events).toEqual(["task:1", "shouldRetry:1", "delay:1", "onRetry:1"]);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(99);
    expect(events).toHaveLength(4);
    await vi.advanceTimersByTimeAsync(1);
    expect(events).toEqual([
      "task:1",
      "shouldRetry:1",
      "delay:1",
      "onRetry:1",
      "task:2",
      "shouldRetry:2",
      "delay:2",
      "onRetry:2",
    ]);
    for (let attempt = 1; attempt <= 2; attempt++) {
      const context = { attempt, retriesLeft: 3 - attempt, elapsed: (attempt - 1) * 100 };
      expect(shouldRetry).toHaveBeenNthCalledWith(attempt, error, { ...context, delay: 0 });
      expect(delay).toHaveBeenNthCalledWith(attempt, error, context);
      expect(onRetry).toHaveBeenNthCalledWith(attempt, error, { ...context, delay: attempt * 100 });
      expect(context.elapsed).toBeGreaterThanOrEqual(0);
    }
    await vi.advanceTimersByTimeAsync(199);
    expect(events).toHaveLength(8);
    await vi.advanceTimersByTimeAsync(1);
    await assertion;
    expect(events.at(-1)).toBe("task:3");
    expect(delay).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  test("awaits asynchronous hooks before computing the delay or starting a timer", async () => {
    let decide!: (value: boolean) => void;
    let finishHook!: () => void;
    const task = vi.fn((attempt: number) => {
      if (attempt === 1) throw new Error("task");
      return "done";
    });
    const delay = vi.fn(() => 100);
    const onRetry = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishHook = resolve;
        }),
    );
    const result = retry(task, {
      shouldRetry: () =>
        new Promise<boolean>((resolve) => {
          decide = resolve;
        }),
      delay,
      onRetry,
    });
    await vi.advanceTimersByTimeAsync(50);
    expect(delay).not.toHaveBeenCalled();
    decide(true);
    await vi.advanceTimersByTimeAsync(50);
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledWith(expect.any(Error), {
      attempt: 1,
      retriesLeft: 2,
      delay: 100,
      elapsed: 0,
    });
    expect(delay).toHaveBeenCalledWith(expect.any(Error), {
      attempt: 1,
      retriesLeft: 2,
      elapsed: 0,
    });
    expect(vi.getTimerCount()).toBe(0);
    expect(task).toHaveBeenCalledTimes(1);
    finishHook();
    await vi.advanceTimersByTimeAsync(99);
    expect(task).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(result).resolves.toBe("done");
  });

  test.each(["task", "shouldRetry", "delay", "onRetry"] as const)(
    "observes cancellation in %s before subsequent callbacks or attempts",
    async (stage) => {
      const controller = new AbortController();
      const reason = new Error("abort");
      const abortAt = (current: string) => {
        if (stage === current) controller.abort(reason);
      };
      const task = vi.fn(() => {
        abortAt("task");
        throw new Error("task");
      });
      const shouldRetry = vi.fn(async () => {
        abortAt("shouldRetry");
        return true;
      });
      const delay = vi.fn(async () => {
        abortAt("delay");
        return 100;
      });
      const onRetry = vi.fn(async () => {
        abortAt("onRetry");
      });
      await expect(
        retry(task, { signal: controller.signal, shouldRetry, delay, onRetry }),
      ).rejects.toBe(reason);
      expect(task).toHaveBeenCalledTimes(1);
      expect(shouldRetry).toHaveBeenCalledTimes(stage === "task" ? 0 : 1);
      expect(delay).toHaveBeenCalledTimes(stage === "task" || stage === "shouldRetry" ? 0 : 1);
      expect(onRetry).toHaveBeenCalledTimes(stage === "onRetry" ? 1 : 0);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  test("does not call onRetry when delay computation fails validation", async () => {
    const onRetry = vi.fn();
    await expect(
      retry(
        () => {
          throw new Error("task");
        },
        {
          delay: () => Infinity,
          onRetry,
        },
      ),
    ).rejects.toThrow(RangeError);
    expect(onRetry).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
