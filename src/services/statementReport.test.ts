import test from "node:test";
import assert from "node:assert/strict";
import { generateStatementReport, generateStatementReportCsv } from "./statementReportService.js";

test("statement report generator produces audited period summary and valid CSV", () => {
  const report = generateStatementReport({
    startDate: "2020-01-01",
    endDate: "2026-12-31",
    groupBy: "total",
    baseCurrency: "CAD"
  });

  assert.ok(report);
  assert.ok(report.summary);
  assert.equal(report.summary.currency, "CAD");
  assert.ok(Array.isArray(report.rows));

  const csv = generateStatementReportCsv(report);
  assert.ok(csv.includes("Period,Start Date,End Date"));
  assert.ok(csv.includes("Total Profit"));
});
