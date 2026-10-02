import type { RetryContext, RetryOptions, RetryTask } from "./types";
import { validateDelay } from "./validation";

/**
 * Retries a task after thrown errors or rejected promises.
 *
 * `retries` counts additional attempts after the initial call and defaults to `3`.
 * The task receives attempt numbers starting at `1`.
 * Delays default to zero and are only computed when another attempt is available.
 * An abort stops future attempts and active delays with `signal.reason`.
 * An active task is not forcibly cancelled; pass the signal to its underlying API
 * to cancel that work. A successful active task still returns its value.
 *
 * Hooks run in order: `shouldRetry`, delay computation, then `onRetry` before waiting.
 * A rejected retry preserves the task error; callback errors propagate unchanged.
 *
 * @param task The synchronous or asynchronous work to attempt.
 * @param options Retry limit, delay, hooks, and signal. Numeric options are validated first.
 * @returns The first successful value, unchanged.
 * @throws {RangeError} When `retries` or a delay is invalid.
 * @throws Any callback error or abort reason unchanged.
 * @throws The task error unchanged when retries are exhausted or `shouldRetry` returns false.
 * @example
 * ```ts
 * const value = await retry(() => fetchData(), { retries: 2 });
 * ```
 */
export const retry = async <T>(task: RetryTask<T>, options: RetryOptions = {}): Promise<T> => {
  const started = performance.now();
  const { retries = 3, delay = 0, signal, shouldRetry, onRetry } = options;

  if (!Number.isInteger(retries) || retries < 0) {
    throw new RangeError("`retries` must be a non-negative integer");
  }

  if (typeof delay !== "function") {
    validateDelay(delay);
  }

  let attempt = 1;

  while (true) {
    if (signal?.aborted) {
      throw signal.reason;
    }

    try {
      return await task(attempt);
    } catch (error) {
      if (attempt > retries) {
        throw error;
      }
      if (signal?.aborted) {
        throw signal.reason;
      }

      const context: Omit<RetryContext, "delay"> = {
        attempt,
        retriesLeft: retries - attempt,
        elapsed: performance.now() - started,
      };
      if (shouldRetry && !(await shouldRetry(error, { ...context, delay: 0 }))) {
        throw error;
      }
      if (signal?.aborted) {
        throw signal.reason;
      }

      const milliseconds = typeof delay === "function" ? await delay(error, { ...context }) : delay;
      validateDelay(milliseconds);
      if (signal?.aborted) {
        throw signal.reason;
      }
      if (onRetry) {
        await onRetry(error, { ...context, delay: milliseconds });
      }
      await wait(milliseconds, signal);
      attempt++;
    }
  }
};

const wait = (delay: number, signal?: AbortSignal): void | Promise<void> => {
  if (signal?.aborted) {
    throw signal.reason;
  }
  if (delay === 0) {
    return;
  }

  return new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      signal!.removeEventListener("abort", onAbort);
      reject(signal!.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, delay);

    if (signal) {
      signal.addEventListener("abort", onAbort, { once: true });
      // Recheck after registration so an abort during setup cannot be missed.
      if (signal.aborted) {
        onAbort();
      }
    }
  });
};
