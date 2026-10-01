/** Options controlling how many times a failed task can be retried. */
export interface RetryOptions {
  /**
   * Number of additional attempts allowed after the initial attempt.
   * Must be a finite non-negative integer. Set to `0` to run the task once.
   *
   * @default 3
   */
  retries?: number;
}

/**
 * A synchronous or asynchronous task receiving a 1-based attempt number.
 * Returned values are successes; thrown errors and rejected promises are failures.
 */
export type RetryTask<T> = (attempt: number) => T | PromiseLike<T>;
