// Standalone unit tests for the pure rate-limit logic.
// Run with:  node server/rateLimit.test.mjs
// No test framework, no network — exits non-zero on the first failure.

import assert from "node:assert/strict";
import {
  DEFAULT_DAILY_CAP,
  resolveDailyCap,
  isUnlimited,
  isOverDailyLimit,
  remainingGenerations,
  startOfUtcDay,
} from "./rateLimit.js";

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log(`  ok  ${name}`);
}

// --- resolveDailyCap --------------------------------------------------------
test("resolveDailyCap defaults when unset", () => {
  assert.equal(resolveDailyCap(undefined), DEFAULT_DAILY_CAP);
  assert.equal(resolveDailyCap(null), DEFAULT_DAILY_CAP);
  assert.equal(resolveDailyCap(""), DEFAULT_DAILY_CAP);
});

test("resolveDailyCap parses a numeric string", () => {
  assert.equal(resolveDailyCap("10"), 10);
  assert.equal(resolveDailyCap("3"), 3);
});

test("resolveDailyCap floors and rejects garbage", () => {
  assert.equal(resolveDailyCap("7.9"), 7);
  assert.equal(resolveDailyCap("abc"), DEFAULT_DAILY_CAP);
});

test("resolveDailyCap treats negative as 0 (unlimited)", () => {
  assert.equal(resolveDailyCap("-1"), 0);
});

// --- isUnlimited ------------------------------------------------------------
test("isUnlimited for 0 and negative", () => {
  assert.equal(isUnlimited(0), true);
  assert.equal(isUnlimited(-5), true);
  assert.equal(isUnlimited(5), false);
});

// --- isOverDailyLimit -------------------------------------------------------
test("isOverDailyLimit blocks at and above the cap", () => {
  assert.equal(isOverDailyLimit(0, 5), false);
  assert.equal(isOverDailyLimit(4, 5), false); // 5th generation still allowed
  assert.equal(isOverDailyLimit(5, 5), true); // 6th blocked
  assert.equal(isOverDailyLimit(6, 5), true);
});

test("isOverDailyLimit never blocks when unlimited", () => {
  assert.equal(isOverDailyLimit(1000, 0), false);
});

// --- remainingGenerations ---------------------------------------------------
test("remainingGenerations counts down and floors at 0", () => {
  assert.equal(remainingGenerations(0, 5), 5);
  assert.equal(remainingGenerations(4, 5), 1);
  assert.equal(remainingGenerations(5, 5), 0);
  assert.equal(remainingGenerations(9, 5), 0);
});

test("remainingGenerations is Infinity when unlimited", () => {
  assert.equal(remainingGenerations(3, 0), Infinity);
});

// --- startOfUtcDay ----------------------------------------------------------
test("startOfUtcDay zeroes the time in UTC", () => {
  const d = new Date("2026-08-09T15:34:12.000Z");
  const start = startOfUtcDay(d);
  assert.equal(start.toISOString(), "2026-08-09T00:00:00.000Z");
});

console.log(`\n${passed} rate-limit tests passed.`);
