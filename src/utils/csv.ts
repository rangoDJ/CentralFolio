/**
 * Minimal RFC 4180 CSV reader.
 *
 * Pure and dependency-free, matching how the app already writes CSV
 * (`t5008Service.dispositionsToCsv`) without pulling in a parser package.
 * Handles quoted fields containing commas, newlines and doubled quotes ("")
 * — the shapes a broker's exported statement actually uses.
 */

/** Split CSV text into rows of raw string cells. Blank lines are dropped. */
export function parseCsv(text: string): string[][] {
  // Strip a UTF-8 BOM — Excel writes one, and it would otherwise become part
  // of the first header name ("﻿date" never matches "date").
  const input = text.replace(/^﻿/, "");

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];

    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') { field += '"'; i++; }   // escaped quote
        else inQuotes = false;
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') { inQuotes = true; continue; }
    if (ch === ",") { row.push(field); field = ""; continue; }
    if (ch === "\r") continue;                              // CRLF → LF
    if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; continue; }
    field += ch;
  }

  // Flush the final field/row when the file doesn't end in a newline.
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter(r => r.some(cell => cell.trim() !== ""));
}

/**
 * Parse CSV with a header row into objects keyed by normalized header name
 * (lowercased, non-alphanumerics collapsed), so "Trade Date", "trade_date"
 * and "TRADEDATE" all resolve to the same key.
 */
export function parseCsvRecords(text: string): { headers: string[]; records: Record<string, string>[] } {
  const rows = parseCsv(text);
  if (rows.length === 0) return { headers: [], records: [] };

  const headers = rows[0].map(h => h.trim().toLowerCase().replace(/[^a-z0-9]/g, ""));
  const records = rows.slice(1).map(cells => {
    const rec: Record<string, string> = {};
    headers.forEach((h, i) => { if (h) rec[h] = (cells[i] ?? "").trim(); });
    return rec;
  });

  return { headers, records };
}
