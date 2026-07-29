import assert from "node:assert/strict";
import test from "node:test";

import { hasSeparateTftPuuidScope } from "../../src/lib/riotKeyScope.mjs";

test("an omitted TFT key shares the LoL PUUID scope", () => {
  assert.equal(
    hasSeparateTftPuuidScope({ RIOT_API_KEY: "lol-key" }),
    false
  );
});

test("an explicitly shared TFT key shares the LoL PUUID scope", () => {
  assert.equal(
    hasSeparateTftPuuidScope({
      RIOT_API_KEY: "same-key",
      RIOT_TFT_API_KEY: " same-key ",
    }),
    false
  );
});

test("a dedicated TFT key has its own PUUID scope", () => {
  assert.equal(
    hasSeparateTftPuuidScope({
      RIOT_API_KEY: "lol-key",
      RIOT_TFT_API_KEY: "tft-key",
    }),
    true
  );
});

test("the legacy TFT_API_KEY setting also creates a separate scope", () => {
  assert.equal(
    hasSeparateTftPuuidScope({
      RIOT_API_KEY: "lol-key",
      TFT_API_KEY: "legacy-tft-key",
    }),
    true
  );
});

test("a blank primary TFT key falls through to the legacy TFT key", () => {
  assert.equal(
    hasSeparateTftPuuidScope({
      RIOT_API_KEY: "lol-key",
      RIOT_TFT_API_KEY: "   ",
      TFT_API_KEY: "legacy-tft-key",
    }),
    true
  );
});
