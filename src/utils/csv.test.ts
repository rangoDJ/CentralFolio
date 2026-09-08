import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCsv, parseCsvRecords } from "./csv.js";

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
