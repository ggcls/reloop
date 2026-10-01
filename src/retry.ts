import type { RetryOptions, RetryTask } from "./types";

/**
 * Retries a task after thrown errors or rejected promises, without a delay.
 *
 * `retries` counts additional attempts after the initial call and defaults to `3`.
 * The task receives attempt numbers starting at `1`.
 *
 * @param task The synchronous or asynchronous work to attempt.
 * @param options The retry limit, validated before the task is called.
 * @returns The first successful value, unchanged.
 * @throws {RangeError} When `retries` is not a finite non-negative integer.
 * @throws The final task error unchanged when all attempts fail.
 * @example
 * ```ts
 * const value = await retry(() => fetchData(), { retries: 2 });
 * ```
 */
export const retry = async <T>(task: RetryTask<T>, options: RetryOptions = {}): Promise<T> => {
  const retries = options.retries === undefined ? 3 : options.retries;

  if (!Number.isInteger(retries) || retries < 0) {
    throw new RangeError("`retries` must be a non-negative integer");
  }

  let attempt = 1;

  while (true) {
    try {
      return await task(attempt);
    } catch (error) {
      if (attempt > retries) {
        throw error;
      }
      attempt++;
    }
  }
};
