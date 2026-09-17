/**
 * The two kinds of SnapTrade API key, and what each implies.
 *
 * A **commercial** key belongs to an app serving other people: you register a
 * SnapTrade user, store the `userSecret` it returns, and send it with every
 * request.
 *
 * A **personal** key represents one person. Its user is provisioned at signup,
 * so registering is not merely unnecessary but unavailable — the API answers
 * `registerUser is not available for personal keys`. There is no `userSecret`,
 * and the SDK drops `userId`/`userSecret` from personal-mode requests even when
 * they are passed, resolving the user from the key itself.
 *
 * Which matters here because "has a userSecret" was this app's test for whether
 * a connection was usable, and a personal-key connection never has one.
 */

export const KEY_TYPES = ["commercial", "personal"] as const;
export type KeyType = (typeof KEY_TYPES)[number];

/** Normalize whatever is stored or submitted; anything unrecognised is commercial. */
export function keyTypeOf(portfolio: { keyType?: string | null } | null | undefined): KeyType {
  return String(portfolio?.keyType ?? "").trim().toLowerCase() === "personal" ? "personal" : "commercial";
}

export function isPersonalKey(portfolio: { keyType?: string | null } | null | undefined): boolean {
  return keyTypeOf(portfolio) === "personal";
}

/**
 * Whether this connection can talk to SnapTrade.
 *
 * Replaces the `!portfolio.userSecret` test that used to mean "registered".
 * A personal key is ready as soon as its credentials are stored, because there
 * is no registration step to complete.
 */
export function isPortfolioConnected(
  portfolio: { keyType?: string | null; clientId?: string | null; consumerKey?: string | null; userSecret?: string | null } | null | undefined,
): boolean {
  if (!portfolio?.clientId || !portfolio?.consumerKey) return false;
  return isPersonalKey(portfolio) ? true : !!portfolio.userSecret;
}

/** The message shown when a connection is not usable, which differs by key type. */
export function notConnectedReason(portfolio: { keyType?: string | null } | null | undefined): string {
  return isPersonalKey(portfolio)
    ? "Connection is missing its SnapTrade credentials"
    : "Portfolio not found or not registered";
}
