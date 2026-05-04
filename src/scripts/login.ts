/**
 * Generates a SnapTrade Connection Portal URL for the registered user.
 *
 * Open the printed URL in your browser to connect a brokerage (e.g.
 * Wealthsimple). The URL is single-use and expires after ~5 minutes.
 *
 * Run: npm run login
 */
import { getSnapTradeClientForPortfolio } from "../services/snaptrade.js";
import { listPortfolios } from "../models/db.js";

async function main() {
  const portfolios = listPortfolios();
  const portfolio = portfolios.length > 0 ? portfolios[0] : null;

  if (!portfolio || !portfolio.userSecret) {
    throw new Error(
      `No registered portfolios found. Please add and register one via the UI first.`,
    );
  }

  console.log(`Requesting login portal URL for portfolio "${portfolio.name}" (userId="${portfolio.userId}") ...`);
  const client = getSnapTradeClientForPortfolio(portfolio);
  const res = await client.authentication.loginSnapTradeUser({
    userId: portfolio.userId,
    userSecret: portfolio.userSecret,
  });

  const data = res.data as any;
  const url = data?.redirectURI ?? data?.redirectUri;
  if (!url) {
    console.error("Unexpected response:", JSON.stringify(data, null, 2));
    throw new Error("No redirect link returned from SnapTrade.");
  }

  // Append broker if needed, or use the one from the API response
  const finalUrl = url.includes('broker=') ? url : `${url}&broker=WEALTHSIMPLETRADE`;

  console.log(`\n✓ Open this URL in your browser to connect to "${portfolio.name}":\n`);
  console.log(finalUrl);
  console.log("\n(Link is single-use and expires in ~5 minutes.)");
}


main().catch((err) => {
  const status = (err as any)?.status;
  const body = (err as any)?.responseBody ?? (err as any)?.response?.data;
  console.error("Login failed.");
  if (status) console.error("HTTP status:", status);
  if (body) console.error("Response body:", JSON.stringify(body, null, 2));
  console.error(err);
  