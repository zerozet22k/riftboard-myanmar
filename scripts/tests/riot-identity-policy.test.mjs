import assert from "node:assert/strict";
import test from "node:test";

import {
  canMergeRiotIdentities,
  hasStoredRiotIdentity,
  isTftRetryBackoffActive,
} from "../../src/lib/riotIdentityPolicy.mjs";

test("an existing PUUID anchors a tracked Riot account across renames", () => {
  assert.equal(hasStoredRiotIdentity(" stored-puuid "), true);
  assert.equal(hasStoredRiotIdentity(""), false);
  assert.equal(hasStoredRiotIdentity(undefined), false);
});

test("duplicate rows merge only when their durable identities are compatible", () => {
  assert.equal(canMergeRiotIdentities("same", "same"), true);
  assert.equal(canMergeRiotIdentities("same", ""), true);
  assert.equal(canMergeRiotIdentities("", "same"), true);
  assert.equal(canMergeRiotIdentities("account-a", "account-b"), false);
});

test("TFT retry backoff blocks normal runs but force bypasses it", () => {
  const nowMs = Date.parse("2026-07-29T12:00:00.000Z");
  const future = new Date(nowMs + 60_000);
  const past = new Date(nowMs - 60_000);

  assert.equal(isTftRetryBackoffActive(future, { nowMs }), true);
  assert.equal(isTftRetryBackoffActive(future, { nowMs, force: true }), false);
  assert.equal(isTftRetryBackoffActive(past, { nowMs }), false);
  assert.equal(isTftRetryBackoffActive(undefined, { nowMs }), false);
});
