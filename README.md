<h1 align="center">
  @ggcls/reloop
</h1>

🔁 Small retry primitives for modern JavaScript runtimes.

- 🪶 **Small:** zero runtime dependencies and a focused API.
- 🌐 **Universal:** standard JavaScript and Web APIs.
- ⏱️ **Composable:** fixed delays, exponential backoff, jitter, and custom strategies.
- 🛑 **Abortable:** retry delays support `AbortSignal`.
- 🧩 **Typed:** TypeScript with ESM declarations.

## Get started

```sh
pnpm add @ggcls/reloop
```

## Usage

### Retry a task

```ts
import { retry } from "@ggcls/reloop";

const task = async () => {
  const response = await fetch("https://example.com/data");
  return response.json();
};

const value = await retry(task);
```

Tasks can return a value or a promise. Throws and rejections trigger retries.
The examples below reuse `task` from above.

```ts
const value = await retry(task, { retries: 2 });
```

**`retries: 2` means 1 initial attempt + 2 retries = at most 3 task calls.**
The default is `3` retries; `retries: 0` makes one attempt.

### Exponential backoff

```ts
import { exponentialBackoff, retry } from "@ggcls/reloop";

await retry(task, {
  retries: 4,
  delay: exponentialBackoff({
    delay: 100,
    factor: 2,
    maxDelay: 5000,
    jitter: "full",
  }),
});
```

For failed attempt `n`, the delay is `delay * factor ** (n - 1)`.
`maxDelay` caps the result before jitter is applied.

### Conditional retries

```ts
await retry(task, {
  shouldRetry(error) {
    return error instanceof TypeError;
  },
  onRetry(_error, context) {
    console.log(`Attempt ${context.attempt} failed; retrying in ${context.delay}ms`);
  },
});
```

Returning `false` from `shouldRetry` stops immediately and rethrows the original
task error. Both hooks can be asynchronous.

### Abort retries

```ts
import { retry } from "@ggcls/reloop";

const controller = new AbortController();
const promise = retry(() => fetch("https://example.com/data", { signal: controller.signal }), {
  retries: 5,
  delay: 1000,
  signal: controller.signal,
});

controller.abort();

try {
  await promise;
} catch (error) {
  if (error !== controller.signal.reason) throw error;
}
```

Abort interrupts an active retry delay and prevents future attempts, rejecting
with `signal.reason`. A running task is **not automatically cancelled**: pass the
same signal to its underlying API, as above, or handle cancellation in the task.
A running task that succeeds still returns its value, even after an abort.

### Retry-After

```ts
import { parseRetryAfter, retry } from "@ggcls/reloop";

const response = await retry(
  async () => {
    const response = await fetch("https://example.com/data");
    if (!response.ok) throw response;
    return response;
  },
  {
    delay(error) {
      if (error instanceof Response) {
        return parseRetryAfter(error.headers.get("retry-after")) ?? 250;
      }
      return 250;
    },
  },
);
```

`parseRetryAfter()` supports integer delay-seconds and HTTP-date values, returning
`undefined` for invalid input. HTTP retries are opt-in: `fetch` resolves on HTTP
error statuses, so this example explicitly throws unsuccessful responses.

## API

### retry

`retry<T>(task: RetryTask<T>, options?: RetryOptions): Promise<T>`

Calls `task(attempt)` with a 1-based attempt number and returns the first successful
value unchanged. Without `shouldRetry`, any task failure is eligible for a retry
while attempts remain.

| Option        | Default | Behavior                                                                            |
| ------------- | ------- | ----------------------------------------------------------------------------------- |
| `retries`     | `3`     | Additional attempts; a finite non-negative integer.                                 |
| `delay`       | `0`     | Milliseconds or a `RetryDelay` callback; must produce a finite non-negative number. |
| `shouldRetry` | —       | `(error, context)` returning a boolean or promise; `false` stops retries.           |
| `onRetry`     | —       | `(error, context)` hook, awaited after delay selection and before waiting.          |
| `signal`      | —       | `AbortSignal` for pending delays and future attempts.                               |

`RetryContext` describes the attempt that just failed:

| Field         | Meaning                                                                                                                        |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `attempt`     | Failed attempt number, starting at `1`.                                                                                        |
| `retriesLeft` | Retries left after reserving the upcoming retry. With `retries: 3`, failures of attempts 1, 2, and 3 report `2`, `1`, and `0`. |
| `delay`       | Selected milliseconds in `onRetry`; `0` in `shouldRetry`, before delay selection.                                              |
| `elapsed`     | Monotonic elapsed milliseconds since `retry()` started, captured once per failure.                                             |

A `RetryDelay` receives `(error, context)` with the same snapshot except for the
`delay` field, and returns a number or promise. Hooks and delay callbacks are
skipped after the final failure. Task and callback errors are never wrapped.

The exported types are `RetryTask`, `RetryOptions`, `RetryContext`, `RetryDelay`,
`BackoffOptions`, and `Jitter`.

### fixedDelay

`fixedDelay(delay: number): RetryDelay`

Returns the same delay in milliseconds for every retry. Validates the finite
non-negative value when the strategy is created.

```ts
import { fixedDelay, retry } from "@ggcls/reloop";

await retry(task, { delay: fixedDelay(500) });
```

### exponentialBackoff

`exponentialBackoff(options?: BackoffOptions): RetryDelay`

| Option     | Default    | Constraint                                                 |
| ---------- | ---------- | ---------------------------------------------------------- |
| `delay`    | `100`      | Finite non-negative base delay in milliseconds.            |
| `factor`   | `2`        | Finite multiplier greater than or equal to `1`.            |
| `maxDelay` | `Infinity` | Non-negative cap in milliseconds; `Infinity` means no cap. |
| `jitter`   | `"none"`   | `"none"`, `"full"`, or `"equal"`.                          |

Options are validated when the strategy is created. For the capped delay `d`:

- `none`: returns `d`.
- `full`: returns `Math.random() * d`.
- `equal`: returns `d / 2 + Math.random() * (d / 2)`.

A zero base returns zero. Numeric overflow uses a finite `maxDelay`; without one,
the strategy throws a `RangeError` before jitter or waiting.

### parseRetryAfter

`parseRetryAfter(value: string | null | undefined, now?: number | Date): number | undefined`

```ts
import { parseRetryAfter } from "@ggcls/reloop";

parseRetryAfter("120"); // 120000
parseRetryAfter("Wed, 21 Oct 2015 07:28:00 GMT", Date.UTC(2015, 9, 21, 7, 27)); // 60000
```

Returns milliseconds. Missing, malformed, or numerically unsafe header values
return `undefined`; dates at or before `now` return `0`. Outer whitespace is
ignored. Seconds must contain only digits: signs, fractions, and exponent notation
are invalid. HTTP dates include the obsolete RFC 850 and asctime formats.

`now` defaults to one read of `Date.now()`. An invalid `Date` or a non-finite or
out-of-range timestamp throws a `RangeError`, even for an absent header.

## Retry semantics

- `retries` counts additional attempts; attempt numbers start at `1`.
- After a failure: check retries and abort → `shouldRetry` → compute delay → `onRetry` → wait → next attempt.
- `delay: 0` creates no timer. There is no wait after the final failure.
- Exhausted or declined retries rethrow the task error unchanged. Errors from `shouldRetry`, `delay`, or `onRetry` propagate unchanged and stop retries.
- Abort stops pending delays and future attempts. Active tasks handle their own cancellation.
- Cancellation or a failing hook can prevent an accepted retry from starting. Timers and abort listeners are cleaned up when a wait settles.

## License

[MIT](./LICENSE)
