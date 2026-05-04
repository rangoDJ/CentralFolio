import YahooFinance from "yahoo-finance2";
const yahooFinance = new YahooFinance();




async function run() {
  try {
    const result = await yahooFinance.quoteSummary("O", { modules: ["summaryDetail", "calendarEvents"] });
    console.log(JSON.stringify(result, null, 2));

    const chartResult = await yahooFinance.chart("O", { 
      period1: "2023-01-01", 
      interval: "1d"
    });
    console.log("Chart events:", chartResult.events);
    if (chartResult.events && chartResult.events.dividends) {
      console.log("Dividends found in chart:", Object.keys(chartResult.events.dividends).length);
    }
  } catch (err) {
    console.error(err);
  }

}

run();
