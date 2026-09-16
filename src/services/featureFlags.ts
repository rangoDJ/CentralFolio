import type { AlertRuleType } from "./alertRules.js";

/**
 * Optional product features the user can switch off under Settings → Features.
 *
 * A feature is on unless its setting is explicitly "false", so existing
 * installs keep every page after upgrading. Turning one off hides its page
 * and pauses any alert rule that only makes sense with it; the underlying
 * data and API stay available because other pages (dashboard, holdings)
 * reuse the same dividend, price and target data.
 */
export const FEATURES = ["compare", "dividends", "watchlist", "rebalance", "tax"] as const;
export type FeatureKey = (typeof FEATURES)[number];

export const featureSettingKey = (feature: FeatureKey) => `feature_${feature}_enabled`;

export const FEATURE_SETTING_KEYS: readonly string[] = FEATURES.map(featureSettingKey);

/** Alert rules that are meaningless while their feature is off. */
export const ALERT_RULE_FEATURE: Partial<Record<AlertRuleType, FeatureKey>> = {
  allocation_drift: "rebalance",
  watchlist_target: "watchlist",
};

export function isEnabledValue(value: string | null | undefined): boolean {
  return value !== "false";
}

/** Reads a raw setting value — pass `getSetting` from models/db in app code. */
export type SettingReader = (key: string) => string | null | undefined;

export function isFeatureEnabled(feature: FeatureKey, read: SettingReader): boolean {
  return isEnabledValue(read(featureSettingKey(feature)));
}

/** The feature pausing this rule, or null if the rule is free to run. */
export function pausingFeature(type: AlertRuleType, read: SettingReader): FeatureKey | null {
  const feature = ALERT_RULE_FEATURE[type];
  return feature && !isFeatureEnabled(feature, read) ? feature : null;
}
