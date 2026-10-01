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
no timer. The callback receives the failed attempt number, the number of retries
still available, and elapsed milliseconds. It is not called after the final failure.

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

## License

[MIT](./LICENSE)
