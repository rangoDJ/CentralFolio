import { getSnapTradeClientForPortfolio } from "../services/snaptrade.js";
import { listPortfolios } from "../models/db.js";

async function main() {
  const portfolios = listPortfolios();
  const portfolio = portfolios.length > 0 ? portfolios[0] : null;

  if (!portfolio) {
    console.error("No portfolios configured.");
    return;
  }

  console.log(`Fetching available brokers using portfolio "${portfolio.name}"...`);
  try {
    const client = getSnapTradeClientForPortfolio(portfolio);
    const res = await client.referenceData.listAllBrokerages();
    const brokers = res.data ?? [];
    
    console.log(`Available brokers (${brokers.length}):`);
    for (const b of brokers) {
      console.log(`  - ${b.name} (slug: ${b.slug})`);
    }
  } catch (err: any) {
    const status = err?.status;
    const body = err?.responseBody ?? err?.response?.data;
    console.error("Fetch failed.");
    if (status) console.error("HTTP status:", status);
    if (body) console.error("Response body:", JSON.stringify(body, null, 2));
    throw err;
  }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
