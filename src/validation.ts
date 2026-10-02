/** Validates delay values shared by retry options and delay strategies. */
export const validateDelay = (delay: unknown): void => {
  if (typeof delay !== "number" || !Number.isFinite(delay) || delay < 0) {
    throw new RangeError("`delay` must be a finite non-negative number");
  }
};
