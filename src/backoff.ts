import type { BackoffOptions, RetryDelay } from "./types";
import { validateDelay } from "./validation";

/**
 * Creates a retry strategy that always returns the same delay.
 *
 * @param delay A finite non-negative delay in milliseconds, validated immediately.
 * @returns A delay callback independent of the error and attempt number.
 * @throws {RangeError} When the delay is invalid.
 * @example
 * ```ts
 * await retry(task, { delay: fixedDelay(250) });
 * ```
 */
export const fixedDelay = (delay: number): RetryDelay => {
  validateDelay(delay);
  return () => delay;
};

/**
 * Creates an exponential retry delay.
 *
 * For failed attempt `n` starting at `1`, computes `delay * factor ** (n - 1)`.
 * The result is capped by `maxDelay` before applying jitter with `Math.random()`.
 * Full jitter ranges from zero to the capped delay; equal jitter ranges from half to all
 * of the capped delay. No jitter returns the capped delay unchanged.
 *
 * @param options Base delay (100 ms), factor (2), cap (Infinity), and jitter ("none").
 * Options are validated when the strategy is created.
 * @returns A delay callback. Overflow uses a finite cap or throws a RangeError
 * before jitter when no finite delay can be produced. A zero base always returns zero.
 * @throws {RangeError} When an option is invalid.
 * @example
 * ```ts
 * await retry(task, {
 *   delay: exponentialBackoff({ delay: 100, factor: 2, maxDelay: 5000 }),
 * });
 * ```
 */
export const exponentialBackoff = (options: BackoffOptions = {}): RetryDelay => {
  const { delay = 100, factor = 2, maxDelay = Infinity, jitter = "none" } = options;
  validateDelay(delay);
  if (typeof factor !== "number" || !Number.isFinite(factor) || factor < 1) {
    throw new RangeError("`factor` must be a finite number greater than or equal to 1");
  }
  if (typeof maxDelay !== "number" || Number.isNaN(maxDelay) || maxDelay < 0) {
    throw new RangeError("`maxDelay` must be a non-negative number or Infinity");
  }
  if (jitter !== "none" && jitter !== "full" && jitter !== "equal") {
    throw new RangeError('`jitter` must be "none", "full", or "equal"');
  }

  return (_error, { attempt }) => {
    // Avoid 0 * Infinity when the exponent overflows with a zero base delay.
    if (delay === 0 || maxDelay === 0) {
      return 0;
    }
    const capped = Math.min(maxDelay, delay * factor ** (attempt - 1));
    if (!Number.isFinite(capped)) {
      throw new RangeError("Exponential delay overflowed; provide a finite `maxDelay`");
    }
    if (jitter === "full") {
      return Math.random() * capped;
    }
    if (jitter === "equal") {
      const half = capped / 2;
      return half + Math.random() * half;
    }
    return capped;
  };
};
