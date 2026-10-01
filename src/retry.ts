import type { RetryOptions, RetryTask } from "./types";

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
 * @param task The synchronous or asynchronous work to attempt.
 * @param options Retry limit, delay, and signal. Numeric options are validated first.
 * @returns The first successful value, unchanged.
 * @throws {RangeError} When `retries` or a delay is invalid.
 * @throws The delay callback error or abort reason unchanged.
 * @throws The final task error unchanged when all attempts fail.
 * @example
 * ```ts
 * const value = await retry(() => fetchData(), { retries: 2 });
 * ```
 */
export const retry = async <T>(task: RetryTask<T>, options: RetryOptions = {}): Promise<T> => {
  const { retries = 3, delay = 0, signal } = options;
  const started = Date.now();

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

      const milliseconds =
        typeof delay === "function"
          ? await delay(error, {
              attempt,
              retriesLeft: retries - attempt + 1,
              elapsed: Date.now() - started,
            })
          : delay;
      validateDelay(milliseconds);
      await wait(milliseconds, signal);
      attempt++;
    }
  }
};

const validateDelay = (delay: unknown): void => {
  if (typeof delay !== "number" || !Number.isFinite(delay) || delay < 0) {
    throw new RangeError("`delay` must be a finite non-negative number");
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
