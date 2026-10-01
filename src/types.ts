/** Options controlling retries, delays, and cancellation of future attempts. */
export interface RetryOptions {
  /**
   * Number of additional attempts allowed after the initial attempt.
   * Must be a finite non-negative integer. Set to `0` to run the task once.
   *
   * @default 3
   */
  retries?: number;

  /**
   * Delay before the next attempt, in milliseconds, or a callback computing it.
   * Must be finite and non-negative. A zero delay does not create a timer.
   *
   * @default 0
   */
  delay?: number | RetryDelay;

  /**
   * Stops future attempts and interrupts retry delays with `signal.reason`.
   * An active task must handle its own cancellation, for example by closing
   * over this signal and passing it to the underlying API.
   */
  signal?: AbortSignal;
}

/**
 * A synchronous or asynchronous task receiving a 1-based attempt number.
 * Returned values are successes; thrown errors and rejected promises are failures.
 */
export type RetryTask<T> = (attempt: number) => T | PromiseLike<T>;

/**
 * Computes a finite non-negative delay in milliseconds after a failed attempt.
 * Receives the task error unchanged. Thrown errors and rejections propagate unchanged.
 */
export type RetryDelay = (
  error: unknown,
  context: {
    /** Number of the attempt that just failed, starting at `1`. */
    attempt: number;
    /** Number of retries still available after the failed attempt. */
    retriesLeft: number;
    /** Time since `retry()` started, in milliseconds. */
    elapsed: number;
  },
) => number | Promise<number>;
