import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCsv, parseCsvRecords, csvCell } from "./csv.js";

test("parses a simple grid", () => {
  assert.deepEqual(parseCsv("a,b\n1,2\n3,4"), [["a", "b"], ["1", "2"], ["3", "4"]]);
});

test("handles quoted fields containing commas", () => {
  assert.deepEqual(
    parseCsv('date,description\n2021-01-01,"Acme, Inc. shares"'),
    [["date", "description"], ["2021-01-01", "Acme, Inc. shares"]],
  );
});

test("handles doubled quotes inside a quoted field", () => {
  assert.deepEqual(parseCsv('a\n"He said ""hi"""'), [["a"], ['He said "hi"']]);
});

test("handles newlines inside a quoted field", () => {
  assert.deepEqual(parseCsv('a,b\n"line1\nline2",x'), [["a", "b"], ["line1\nline2", "x"]]);
});

test("tolerates CRLF line endings and a missing trailing newline", () => {
  assert.deepEqual(parseCsv("a,b\r\n1,2\r\n3,4"), [["a", "b"], ["1", "2"], ["3", "4"]]);
});

test("drops blank lines rather than emitting empty rows", () => {
  assert.deepEqual(parseCsv("a,b\n\n1,2\n\n"), [["a", "b"], ["1", "2"]]);
});

test("strips a UTF-8 BOM so the first header still matches", () => {
  // Excel writes a BOM; without stripping it the first header becomes "﻿date".
  const { headers, records } = parseCsvRecords("﻿date,type\n2021-01-01,BUY");
  assert.deepEqual(headers, ["date", "type"]);
  assert.equal(records[0].date, "2021-01-01");
});

test("normalizes header names so broker column spellings all resolve", () => {
  const { headers } = parseCsvRecords("Trade Date,Unit_Price,QTY\n2021-01-01,1,2");
  assert.deepEqual(headers, ["tradedate", "unitprice", "qty"]);
});

test("pads short rows rather than shifting later columns", () => {
  const { records } = parseCsvRecords("a,b,c\n1,2");
  assert.deepEqual(records[0], { a: "1", b: "2", c: "" });
});

test("empty input yields no records", () => {
  assert.deepEqual(parseCsvRecords(""), { headers: [], records: [] });
  assert.deepEqual(parseCsvRecords("   \n  \n"), { headers: [], records: [] });
});

// ── csvCell: quoting + spreadsheet formula injection ────────────────────────

test("quotes only when the value contains a comma, quote or newline", () => {
  assert.equal(csvCell("ENB.TO"), "ENB.TO");
  assert.equal(csvCell("Acme, Inc."), '"Acme, Inc."');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell("line1\nline2"), '"line1\nline2"');
});

test("null and undefined become empty cells", () => {
  assert.equal(csvCell(null), "");
  assert.equal(csvCell(undefined), "");
});

test("neutralises formulas a spreadsheet would execute", () => {
  // These exports carry broker-supplied descriptions the user never typed.
  assert.equal(csvCell("=1+1"), "'=1+1");
  assert.equal(csvCell("+SUM(A1)"), "'+SUM(A1)");
  assert.equal(csvCell("@SUM(A1)"), "'@SUM(A1)");
  assert.equal(csvCell("=HYPERLINK(\"http://x\")"), '"\'=HYPERLINK(""http://x"")"');
});

test("a leading dash on TEXT is neutralised", () => {
  assert.equal(csvCell("-A note about a loss"), "'-A note about a loss");
});

test("negative NUMBERS are left alone so a spreadsheet can still sum them", () => {
  // Regression: the guard used to quote every value starting with '-', which
  // turned each capital loss in the T5008 export into text.
  assert.equal(csvCell(-100), "-100");
  assert.equal(csvCell(-1234.56), "-1234.56");
  assert.equal(csvCell("-0.5"), "-0.5");
  assert.equal(csvCell(-1e21), "-1e+21");
  assert.equal(csvCell(100), "100");
});

test("the dash sits last in the character class, so it is not a range", () => {
  // A class of [=+-@] would be the range '+' to '@', catching every digit.
  for (const v of ["0abc", "5", "9x", ";x", "<x", ">x", "?x"]) {
    assert.ok(!csvCell(v).startsWith("'"), `${v} must not be escaped`);
  }
});
