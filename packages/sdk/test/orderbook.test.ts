import { test } from "node:test";
import assert from "node:assert/strict";
import { quoteBuy, quoteSell, depthWithin, type Level } from "../src/orderbook.ts";

/** Shaped like the real Kuru MON-AUSD book: a thin touch, then size behind it. */
const BIDS: Level[] = [
  { price: 0.025442, size: 100 },
  { price: 0.02535, size: 300 },
  { price: 0.025191, size: 500 },
];
const ASKS: Level[] = [
  { price: 0.025952, size: 0.0001 },
  { price: 0.026123, size: 300 },
  { price: 0.026211, size: 400 },
];

test("an order inside the touch fills at the touch with no slippage", () => {
  const f = quoteSell(BIDS, 50);
  assert.equal(f.filled, 50);
  assert.equal(f.levelsConsumed, 1);
  assert.equal(f.averagePrice, 0.025442);
  assert.equal(f.slippageBps, 0);
  assert.equal(f.partial, false);
});

/**
 * The number that matters: a size larger than the touch does NOT get the touch price.
 * Showing a player the top of book as their price would be quoting a fill they cannot get.
 */
test("walking past the touch prices the whole order worse", () => {
  const f = quoteSell(BIDS, 400);
  assert.equal(f.filled, 400);
  assert.equal(f.levelsConsumed, 2);

  const expected = (100 * 0.025442 + 300 * 0.02535) / 400;
  assert.ok(Math.abs(f.averagePrice - expected) < 1e-12);
  assert.ok(f.averagePrice < BIDS[0].price, "average is worse than the touch");
  assert.ok(f.slippageBps > 0);
});

test("an order larger than the book fills partially and says so", () => {
  const f = quoteSell(BIDS, 5_000);
  assert.equal(f.partial, true);
  assert.equal(f.filled, 900, "everything resting, and no more");
});

test("buying walks the asks upward", () => {
  const f = quoteBuy(ASKS, 200);
  assert.ok(f.averagePrice > ASKS[0].price, "average is worse than the touch");
  assert.equal(f.partial, false);
  assert.ok(f.slippageBps > 0);
});

/** A dust order at the touch must not be mistaken for real liquidity. */
test("a dust level at the touch barely moves the average", () => {
  const f = quoteBuy(ASKS, 100);
  assert.ok(Math.abs(f.averagePrice - 0.026123) < 1e-5);
});

test("an empty or zero-size request quotes nothing rather than guessing", () => {
  assert.equal(quoteSell([], 10).filled, 0);
  assert.equal(quoteSell(BIDS, 0).filled, 0);
  assert.equal(quoteBuy([], 10).filled, 0);
  assert.equal(quoteSell(BIDS, 10).partial, false);
});

test("depth within a band counts both sides", () => {
  const d = depthWithin(BIDS, ASKS, 100); // 1%
  assert.ok(d > 0);
  assert.ok(d <= 1600.0001);
});
