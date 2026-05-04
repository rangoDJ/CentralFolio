import { getAllDividendsForAllPortfolios } from "../src/services/dividendService.js";

async function test() {
  try {
    console.log("Fetching all dividends...");
    const results = await getAllDividendsForAllPortfolios();
    console.log(JSON.stringify(results, null, 2));
  } catch (err) {
    console.error("Test failed:", err);
  }
}

test();
