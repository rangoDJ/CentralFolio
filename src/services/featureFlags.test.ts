import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FEATURES,
  FEATURE_SETTING_KEYS,
  featureSettingKey,
  isEnabledValue,
  isFeatureEnabled,
  pausingFeature,
} from "./featureFlags.js";

const reader = (values: Record<string, string>) => (key: string) => values[key] ?? null;

test("features default to on so upgrades keep every page", () => {
  for (const f of FEATURES) assert.equal(isFeatureEnabled(f, reader({})), true);
  assert.equal(isEnabledValue(null), true);
  assert.equal(isEnabledValue(undefined), true);
  assert.equal(isEnabledValue("true"), true);
});

test("only an explicit 'false' turns a feature off", () => {
  assert.equal(isFeatureEnabled("tax", reader({ feature_tax_enabled: "false" })), false);
  assert.equal(isFeatureEnabled("tax", reader({ feature_tax_enabled: "0" })), true);
});

test("setting keys follow feature_<name>_enabled", () => {
  assert.equal(featureSettingKey("dividends"), "feature_dividends_enabled");
  assert.equal(FEATURE_SETTING_KEYS.length, FEATURES.length);
});

test("alert rules tied to a disabled feature are paused", () => {
  const off = reader({ feature_rebalance_enabled: "false", feature_watchlist_enabled: "false" });
  assert.equal(pausingFeature("allocation_drift", off), "rebalance");
  assert.equal(pausingFeature("watchlist_target", off), "watchlist");
  assert.equal(pausingFeature("allocation_drift", reader({})), null);
});

test("rules without a feature dependency are never paused", () => {
  const allOff = reader(Object.fromEntries(FEATURE_SETTING_KEYS.map(k => [k, "false"])));
  assert.equal(pausingFeature("dividend_cut", allOff), null);
  assert.equal(pausingFeature("ex_dividend_soon", allOff), null);
  assert.equal(pausingFeature("rating_downgrade", allOff), null);
});
