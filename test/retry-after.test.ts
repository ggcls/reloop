import { afterEach, describe, expect, test, vi } from "vitest";
import { parseRetryAfter } from "../src/index";

const now = Date.UTC(2015, 9, 21, 7, 27);
const header = "Wed, 21 Oct 2015 07:28:00 GMT";

afterEach(() => vi.restoreAllMocks());

describe("parseRetryAfter seconds", () => {
  test.each([
    ["0", 0],
    ["1", 1000],
    ["60", 60_000],
    ["120", 120_000],
    ["00060", 60_000],
    [" 120\t", 120_000],
    ["9007199254740", 9_007_199_254_740_000],
  ] as const)("converts %j to %i milliseconds", (value, expected) => {
    expect(parseRetryAfter(value, now)).toBe(expected);
  });

  test.each([
    null,
    undefined,
    "",
    "   ",
    "\t",
    "-1",
    "-0",
    "1.5",
    "1e3",
    "NaN",
    "Infinity",
    "+10",
    "10foo",
    "0x10",
    "1 0",
    "1\n0",
    "9007199254741",
    "9".repeat(400),
    "hello",
    "2015-10-21",
    "2015-10-21T07:28:00Z",
  ])("returns undefined for invalid input %j", (value) => {
    expect(parseRetryAfter(value, now)).toBeUndefined();
  });

  test.each([42, true, {}, []])("does not throw for a non-string header %j", (value) => {
    expect(parseRetryAfter(value as unknown as string, now)).toBeUndefined();
  });
});

describe("parseRetryAfter HTTP dates", () => {
  test("uses an explicit numeric timestamp", () => {
    expect(parseRetryAfter(header, now)).toBe(60_000);
  });

  test("uses an explicit Date without mutating it", () => {
    const reference = new Date(now);
    expect(parseRetryAfter(header, reference)).toBe(60_000);
    expect(reference.getTime()).toBe(now);
  });

  test.each([60_000, 120_000, 1_000_000])(
    "never returns a negative delay (offset: %i)",
    (offset) => {
      expect(parseRetryAfter(header, now + offset)).toBe(0);
    },
  );

  test("trims outer whitespace", () => {
    expect(parseRetryAfter(` \t${header}  `, now)).toBe(60_000);
  });

  test("supports fractional reference milliseconds", () => {
    expect(parseRetryAfter(header, now + 0.5)).toBe(59_999.5);
  });

  test("supports a leap day", () => {
    expect(parseRetryAfter("Thu, 29 Feb 2024 00:00:00 GMT", Date.UTC(2024, 1, 28))).toBe(
      86_400_000,
    );
  });

  test.each([
    "Wed, 32 Oct 2015 07:28:00 GMT",
    "Wed, 21 Nope 2015 07:28:00 GMT",
    "Wed, 21 Oct 2015 25:00:00 GMT",
    "Wed, 21 Oct 2015 07:60:00 GMT",
    "Wed, 21 Oct 2015 07:28:61 GMT",
    "Fri, 31 Feb 2023 00:00:00 GMT",
    "Thu, 29 Feb 2023 00:00:00 GMT",
    "Foo, 21 Oct 2015 07:28:00 GMT",
    "Wed, 21 Oct 2015 07:28:00 GMT junk",
    "Wed, 21 Oct 2015 07:28:00",
    "Wed, 21 Oct 2015",
  ])("rejects malformed dates %j", (value) => {
    expect(parseRetryAfter(value, now)).toBeUndefined();
  });

  test.each([
    "Sunday, 06-Nov-94 08:49:37 GMT",
    "Sun Nov  6 08:49:37 1994",
    "Sun Nov 06 08:49:37 1994",
    "Sun, 06 Nov 1994 08:49:37 GMT",
  ])("accepts HTTP date format %j", (value) => {
    expect(parseRetryAfter(value, Date.UTC(1994, 10, 6, 8, 48, 37))).toBe(60_000);
  });

  test("interprets obsolete dates more than 50 years ahead in the previous century", () => {
    expect(parseRetryAfter("Sunday, 06-Nov-94 08:49:37 GMT", Date.UTC(2026, 9, 2))).toBe(0);
  });

  test("handles obsolete dates across a century boundary", () => {
    const reference = Date.UTC(1999, 11, 31, 23, 59);
    expect(parseRetryAfter("Saturday, 01-Jan-00 00:00:00 GMT", reference)).toBe(60_000);
  });

  test("keeps date differences safe even at the oldest reference timestamp", () => {
    expect(parseRetryAfter("Fri, 31 Dec 9999 23:59:59 GMT", -8_640_000_000_000_000)).toBe(
      8_893_402_300_799_000,
    );
    expect(parseRetryAfter("Fri, 31 Dec 9999 23:59:59 GMT", -8_640_000_000_000_000)).toBeLessThan(
      Number.MAX_SAFE_INTEGER,
    );
  });
});

describe("reference clock", () => {
  test("reads the default clock once", () => {
    const clock = vi
      .spyOn(Date, "now")
      .mockReturnValueOnce(now)
      .mockReturnValue(now + 1000);
    expect(parseRetryAfter(header)).toBe(60_000);
    expect(clock).toHaveBeenCalledTimes(1);
  });

  test("does not read the clock with an explicit reference", () => {
    const clock = vi.spyOn(Date, "now");
    expect(parseRetryAfter(header, now)).toBe(60_000);
    expect(parseRetryAfter(header, new Date(now))).toBe(60_000);
    expect(clock).not.toHaveBeenCalled();
  });

  test.each([
    NaN,
    Infinity,
    -Infinity,
    new Date(NaN),
    8_640_000_000_000_001,
    -8_640_000_000_000_001,
    null,
    "123",
  ])("rejects invalid now %s", (reference) => {
    for (const value of [header, "120", null]) {
      expect(() => parseRetryAfter(value, reference as number | Date)).toThrow(
        new RangeError("`now` must be a valid Date or a finite timestamp within the Date range"),
      );
    }
  });
});
