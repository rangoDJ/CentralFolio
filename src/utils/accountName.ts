/**
 * The one place that decides what an account is called.
 *
 * A user-set custom name always wins over the broker's own label — that is the
 * whole point of renaming an account. Every screen, export, alert and order
 * confirmation has to agree, so nothing resolves this by hand: the rule lives
 * here and `getCachedAccounts` stamps the result onto every row as
 * `displayName`.
 */
export function accountDisplayName(
  account: { customName?: string | null; name?: string | null } | null | undefined,
  fallback = "Account"
): string {
  const custom = account?.customName?.trim();
  if (custom) return custom;
  const broker = account?.name?.trim();
  if (broker) return broker;
  return fallback;
}

/**
 * The text account classification reads (registered vs taxable).
 *
 * The custom name is included deliberately: someone who renames an account
 * "TFSA — long term" expects it to be treated as registered even when the
 * broker's own label says nothing useful.
 */
export function accountClassifyText(
  account: { customName?: string | null; name?: string | null; type?: string | null } | null | undefined
): string {
  return `${account?.type ?? ""} ${account?.customName ?? ""} ${account?.name ?? ""}`.trim();
}
