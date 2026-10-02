const DELAY_SECONDS_PATTERN = /^\d+$/;
const RFC850_DATE_PATTERN =
  /^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday), (\d{2})-([A-Za-z]{3})-(\d{2}) (\d{2}:\d{2}:\d{2}) GMT$/;
const ASCTIME_DATE_PATTERN =
  /^([A-Za-z]{3}) ([A-Za-z]{3}) (\d{2}| \d) (\d{2}:\d{2}:\d{2}) (\d{4})$/;
const IMF_FIXDATE_PATTERN = /^[A-Za-z]{3}, \d{2} [A-Za-z]{3} \d{4} \d{2}:\d{2}:\d{2} GMT$/;

/**
 * Parses an HTTP `Retry-After` header into a delay in milliseconds.
 *
 * Accepts non-negative integer seconds and HTTP dates, ignoring outer whitespace.
 * Dates at or before `now` return zero. Invalid headers and delays exceeding
 * `Number.MAX_SAFE_INTEGER` milliseconds return `undefined`.
 *
 * @param value Header value to parse.
 * @param now Reference timestamp in milliseconds or a valid Date. Defaults to
 * `Date.now()`, read once per call. Must be finite and within the Date range.
 * @returns A non-negative delay, or `undefined` when the header is invalid.
 * @throws {RangeError} When `now` is invalid, even if the header is absent.
 * @example
 * ```ts
 * parseRetryAfter("120"); // 120000
 * parseRetryAfter("Wed, 21 Oct 2015 07:28:00 GMT", Date.UTC(2015, 9, 21, 7, 27)); // 60000
 * ```
 */
export const parseRetryAfter = (
  value: string | null | undefined,
  now: number | Date = Date.now(),
): number | undefined => {
  const reference = now instanceof Date ? now.getTime() : now;
  if (!Number.isFinite(reference) || Math.abs(reference) > 8_640_000_000_000_000) {
    throw new RangeError("`now` must be a valid Date or a finite timestamp within the Date range");
  }
  if (typeof value !== "string") {
    return undefined;
  }
  const header = value.trim();
  if (DELAY_SECONDS_PATTERN.test(header)) {
    const milliseconds = Number(header) * 1000;
    return Number.isSafeInteger(milliseconds) ? milliseconds : undefined;
  }

  const timestamp = parseHttpDate(header, reference);
  if (timestamp === undefined) {
    return undefined;
  }
  return Math.max(0, timestamp - reference);
};

const parseHttpDate = (header: string, reference: number): number | undefined => {
  // Normalize obsolete HTTP formats to GMT before using the platform parser.
  const obsolete = RFC850_DATE_PATTERN.exec(header);
  if (obsolete) {
    const limit = new Date(reference);
    const referenceYear = limit.getUTCFullYear();
    limit.setUTCFullYear(referenceYear + 50);
    let year = Math.floor(referenceYear / 100) * 100 + Number(obsolete[4]);
    if (year < referenceYear - 50) {
      year += 100;
    }
    const date = `${obsolete[2]} ${obsolete[3]} ${year} ${obsolete[5]} GMT`;
    if (Date.parse(date) > limit.getTime()) {
      year -= 100;
    }
    header = `${obsolete[1]!.slice(0, 3)}, ${obsolete[2]} ${obsolete[3]} ${year} ${obsolete[5]} GMT`;
  } else {
    header = header.replace(
      ASCTIME_DATE_PATTERN,
      (_match, weekday: string, month: string, day: string, time: string, year: string) =>
        `${weekday}, ${day.trim().padStart(2, "0")} ${month} ${year} ${time} GMT`,
    );
  }

  if (!IMF_FIXDATE_PATTERN.test(header)) {
    return undefined;
  }
  const timestamp = Date.parse(header);
  // Reject invalid calendar dates that Date.parse might silently normalize.
  return new Date(timestamp).toUTCString() === header ? timestamp : undefined;
};
