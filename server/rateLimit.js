// Pure, dependency-free rate-limit logic so it can be unit-tested in isolation
// (see rateLimit.test.mjs). No network, no DB, no env reads happen here — the
// caller passes in the current usage count and the cap.

// Default free-tier daily generation cap; overridable via FREE_DAILY_GENERATIONS.
export const DEFAULT_DAILY_CAP = 5;

// Parse the configured cap. Falls back to DEFAULT_DAILY_CAP for missing/invalid
// values. A value <= 0 means "unlimited" and is preserved as 0.
export function resolveDailyCap(envValue, fallback = DEFAULT_DAILY_CAP) {
  if (envValue === undefined || envValue === null || envValue === "") {
    return fallback;
  }
  const n = Number(envValue);
  if (!Number.isFinite(n)) return fallback;
  const floored = Math.floor(n);
  return floored < 0 ? 0 : floored;
}

// A cap of 0 (or negative) disables the limit entirely.
export function isUnlimited(cap) {
  return !Number.isFinite(cap) || cap <= 0;
}

// Whether a user who has already used `usedCount` generations today is over the
// cap and must be blocked BEFORE the next generation runs.
export function isOverDailyLimit(usedCount, cap) {
  if (isUnlimited(cap)) return false;
  return usedCount >= cap;
}

// Generations left for a user who has used `usedCount` today. `Infinity` when
// unlimited. Never negative.
export function remainingGenerations(usedCount, cap) {
  if (isUnlimited(cap)) return Infinity;
  return Math.max(0, cap - usedCount);
}

// UTC start-of-day for a given date (default now). The usage query counts events
// with created_at >= this instant, so the window resets at 00:00 UTC.
export function startOfUtcDay(date = new Date()) {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  );
}
