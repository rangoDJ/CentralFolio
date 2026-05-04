/**
 * Sanity check — lists all SnapTrade end-user IDs registered under your
 * partner account. Useful right after `npm run register` to confirm the
 * user actually showed up on SnapTrade's side.
 *
 * Run: npm run list-users
 */
import { listAllUsersAcrossPortfolios } from "../services/snaptrade.js";

async function main() {
  console.log("Listing unique users across all configured portfolios...");
  const users = await listAllUsersAcrossPortfolios();
  if (users.length === 0) {
    console.log("No users registered yet.");
    return;
  }
  console.log(`Registered SnapTrade users (${users.length}):`);
  for (const u of users) console.log(`  - ${u}`);
}


main().catch((err) => {
  const status = (err as any)?.status;
  const body = (err as any)?.responseBody ?? (err as any)?.response?.data;
  console.error("List failed.");
  if (status) console.error("HTTP status:", status);
  if (body) console.error("Response body:", JSON.stringify(body, null, 2));
  console.error(err);
  process.exit(1);
});
