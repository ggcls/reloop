import { describe, expect, test, vi } from "vitest";
import { retry, type RetryOptions } from "../src/index";

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
