import { listPortfolios } from "../src/db.js";
import { getSnapTradeClientForPortfolio } from "../src/client.js";

async function probe() {
  const portfolios = listPortfolios();
  console.log(`Found ${portfolios.length} portfolios in DB.\n`);

  for (const p of portfolios) {
    console.log(`--- Portfolio: ${p.name} ---`);
    console.log(`User ID: ${p.userId}`);
    console.log(`Registered: ${!!p.userSecret}`);

    if (p.userSecret) {
      try {
        const client = getSnapTradeClientForPortfolio(p);
        const response = await client.accountInformation.listUserAccounts({
          userId: p.userId,
          userSecret: p.userSecret,
        });

        const accounts = response.data as any[];
        console.log(`Accounts found: ${accounts.length}`);
        accounts.forEach((acc: any) => {
          console.log(`  - [${acc.brokerage?.name}] ${acc.name} (${acc.number})`);
          console.log(`    Balance: $${acc.balance?.total?.amount?.toLocaleString() || '0.00'}`);
        });
      } catch (err: any) {
        const body = err?.responseBody ?? err?.response?.data;
        console.error(`  Error fetching accounts:`, body?.detail || err.message);
      }
    } else {
      console.log(`  (Not registered, skipping account fetch)`);
    }
    console.log("");
  }
}

probe().catch(console.error);
