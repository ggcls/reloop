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
import { retry } from "reloop";

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
Tasks can be synchronous or asynchronous. Retries run without a delay, and the
final task error is rethrown unchanged if all attempts fail.

## License

[MIT](./LICENSE)
