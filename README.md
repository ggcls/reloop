<h1 align="center">
  reloop
</h1>

🔁 Small retry primitives for modern JavaScript runtimes.

- 🪶 **Small:** zero runtime dependencies.
- 🧩 **Typed:** TypeScript with ESM declarations.

## Get started

```sh
pnpm add @ggcls/reloop
```

## Usage

```ts
import { retry } from "@ggcls/reloop";

let calls = 0;

async function fetchData() {
  calls++;
  if (calls === 1) {
    throw new Error("Temporary failure");
  }
  return { message: "done" };
}

const value = await retry(() => fetchData(), { retries: 2 });
```

`retries` counts additional attempts after the initial call and defaults to `3`.
Set it to `0` for a single attempt. Attempt numbers start at `1`.
Tasks can be synchronous or asynchronous. Retries run without a delay by default, and the
final task error is rethrown unchanged if all attempts fail.

### Delay

```ts
await retry(() => fetchData(), { retries: 2, delay: 250 });

await retry(() => fetchData(), {
  delay: async (_error, context) => context.attempt * 100,
});
```

Delays must be finite non-negative numbers in milliseconds. A zero delay creates
no timer. The callback receives the failed attempt number, retries remaining after reserving
the upcoming retry, and elapsed milliseconds. With `retries: 3`, `retriesLeft` is
`2` after attempt 1 fails, then `1` after attempt 2 fails. The callback is not called
after the final failure.

### Backoff strategies

```ts
import { fixedDelay, exponentialBackoff } from "@ggcls/reloop";

await retry(() => fetchData(), { delay: fixedDelay(250) });

await retry(() => fetchData(), {
  delay: exponentialBackoff({
    delay: 100,
    factor: 2,
    maxDelay: 5000,
    jitter: "full",
  }),
});
```

Both helpers return a `RetryDelay` and validate their options immediately.
`fixedDelay` always returns the supplied finite non-negative delay.
`exponentialBackoff` computes `delay * factor ** (attempt - 1)` using the failed
attempt number, starting at `1`, then applies the cap before jitter.

Defaults are `delay: 100`, `factor: 2`, `maxDelay: Infinity`, and `jitter: "none"`.
The base delay must be finite and non-negative; the factor must be finite and at
least `1`. The cap must be non-negative and may be `Infinity`.

- `none`: the capped delay unchanged.
- `full`: `Math.random() * cappedDelay`.
- `equal`: `cappedDelay / 2 + Math.random() * (cappedDelay / 2)`.

A zero base always returns zero. Numeric overflow uses a finite `maxDelay`; without
one, the strategy throws a `RangeError` before jitter or waiting.

### Retry decisions and hooks

```ts
await retry(() => fetchData(), {
  shouldRetry: (error) => error instanceof Error && error.message === "Temporary failure",
  delay: (_error, context) => context.attempt * 100,
  onRetry: (_error, context) => {
    console.log(`Attempt ${context.attempt} failed; retrying in ${context.delay}ms`);
  },
});
```

After a failure, `retry` checks that retries remain and the signal is not aborted,
then calls `shouldRetry`, computes and validates the delay, calls `onRetry`, and
waits before the next attempt. All three callbacks can be synchronous or asynchronous.
Returning `false` from `shouldRetry` rethrows the original task error and skips the
delay and `onRetry`. Callback errors propagate unchanged and stop further attempts.

`RetryContext` describes the failed attempt. `shouldRetry` receives `delay: 0`
because the delay has not been selected yet; `onRetry` receives the selected delay.
`elapsed` is a monotonic elapsed time in milliseconds, captured once for each
failure and shared across its callbacks. Hooks are skipped after the final failure.
An abort observed between callbacks stops the remaining steps; cancellation or a
hook failure can still prevent an accepted retry from starting.

### Cancellation

```ts
const controller = new AbortController();
const result = retry(() => fetchData(), {
  delay: 250,
  signal: controller.signal,
});
controller.abort(new Error("Cancelled"));
await result.catch((error) => console.log(error));
```

Abort stops future attempts and interrupts retry delays with exactly `signal.reason`.
An active task is not forcibly cancelled. Pass the same signal to the underlying
API when that work needs cancellation; a successful active task still returns its value.

### Retry-After

```ts
import { parseRetryAfter } from "@ggcls/reloop";

parseRetryAfter("120"); // 120000
parseRetryAfter("Wed, 21 Oct 2015 07:28:00 GMT", Date.UTC(2015, 9, 21, 7, 27)); // 60000
```

`parseRetryAfter(value, now?)` accepts non-negative integer seconds or an HTTP date,
including the obsolete RFC 850 and asctime formats. Outer whitespace is ignored.
Past dates return `0`; malformed headers and seconds exceeding safe millisecond
precision return `undefined`. Numeric signs, fractions, and exponent notation are
invalid. HTTP dates are interpreted in GMT.

`now` accepts a timestamp or a `Date` and defaults to one read of `Date.now()`.
An invalid reference time throws a `RangeError`, including for an absent header.
The helper is independent of `retry()`; use it inside a custom delay callback
with a fallback such as `parseRetryAfter(header) ?? 250`.

## License

[MIT](./LICENSE)
