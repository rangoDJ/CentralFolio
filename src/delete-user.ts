import { deleteUserFromPortfolios } from "./client.js";
import { listPortfolios } from "./db.js";

async function main() {
  const portfolios = listPortfolios();
  const portfolio = portfolios.length > 0 ? portfolios[0] : null;

  if (!portfolio) {
    console.error("No portfolios configured.");
    return;
  }

  const userId = portfolio.userId;
  console.log(`Deleting SnapTrade user "${userId}" from all configured portfolios...`);
  try {
    await deleteUserFromPortfolios(userId);
    console.log("✓ Deleted.");
  } catch (err: any) {
    const status = err?.status;
    const body = err?.responseBody ?? err?.response?.data;
    console.error("Deletion failed.");
    if (status) console.error("HTTP status:", status);
    if (body) console.error("Response body:", JSON.stringify(body, null, 2));
    throw err;
  }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
