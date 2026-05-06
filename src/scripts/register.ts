/**
 * Registers a SnapTrade end-user.
 *
 * SnapTrade returns a `userSecret` ONLY at registration time. We persist it
 * locally to the database — every subsequent SnapTrade call for this
 * user requires (userId, userSecret) together.
 *
 * Run: npm run register
 */
import { getSnapTradeClientForPortfolio } from "../services/snaptrade.js";
import { listPortfolios, savePortfolio } from "../models/db.js";

async function main() {
  const portfolios = listPortfolios();
  const portfolio = portfolios.length > 0 ? portfolios[0] : null;

  if (!portfolio) {
    console.error("No portfolios configured. Please add one via the UI first.");
    return;
  }

  if (portfolio.userSecret) {
    console.log(
      `✓ Already have credentials for portfolio "${portfolio.name}" (userId="${portfolio.userId}") in the database. ` +
        `Use the UI to manage or wipe if you need to re-register.`,
    );
    return;
  }

  console.log(`Registering SnapTrade user for portfolio "${portfolio.name}": ${portfolio.userId} ...`);
  const client = getSnapTradeClientForPortfolio(portfolio);
  const res = await client.authentication.registerSnapTradeUser({
    userId: portfolio.userId,
  });

  const { userId, userSecret } = res.data;
  if (!userId || !userSecret) {
    throw new Error(
      `Unexpected response from SnapTrade: ${JSON.stringify(res.data)}`,
    );
  }

  savePortfolio({ ...portfolio, userSecret });

  console.log(`✓ Registered. Saved userSecret to database for portfolio "${portfolio.name}".`);
  console.log(`  userId:     ${userId}`);
  console.log(`  userSecret: ${userSecret.slice(0, 6)}… (truncated)`);
}


main().catch((err) => {
  const status = (err as any)?.status;
  const body = (err as any)?.responseBody ?? (err as any)?.response?.data;
  console.error("Registration failed.");
  if (status) console.error("HTTP status:", status);
  if (body) console.error("Response body:", JSON.stringify(body, null, 2));
  console.error(err);
});
  