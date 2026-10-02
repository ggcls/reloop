/** Options controlling retry decisions, delays, hooks, and cancellation. */
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
   * Decides whether a failed attempt can be retried, before computing its delay.
   * Called only when retries remain and the signal is not already aborted.
   * The context has `delay: 0` because no delay has been selected yet.
   * Returning false rethrows the task error unchanged. Callback errors and
   * rejected promises also propagate unchanged.
   */
  shouldRetry?: (error: unknown, context: RetryContext) => boolean | Promise<boolean>;

  /**
   * Runs after a retry is accepted and its delay validated, before waiting.
   * Receives the task error unchanged and the selected delay in `context.delay`.
   * Skipped when retries are exhausted, declined, or cancellation is observed.
   * Errors and rejected promises propagate unchanged, preventing the wait and
   * next attempt. Cancellation can still prevent an accepted retry from starting.
   */
  onRetry?: (error: unknown, context: RetryContext) => void | Promise<void>;

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
  context: Omit<RetryContext, "delay">,
) => number | Promise<number>;

/**
 * Snapshot of the attempt that just failed, not the upcoming attempt.
 * Elapsed time is captured once per failure and shared across its callbacks.
 */
export interface RetryContext {
  /** Number of the attempt that just failed. The first attempt is `1`. */
  attempt: number;

  /**
   * Retries remaining after reserving the retry for this failure.
   * With `retries: 3`, failures of attempts 1 and 2 report 2 and 1 respectively.
   */
  retriesLeft: number;

  /** Selected delay in milliseconds; `0` in `shouldRetry`, before selection. */
  delay: number;

  /** Time elapsed since `retry()` started, in milliseconds, on a monotonic clock. */
  elapsed: number;
}
