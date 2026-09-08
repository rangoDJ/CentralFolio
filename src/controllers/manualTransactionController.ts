import { Request, Response } from "express";
import {
  listManualTransactions,
  getManualTransaction,
  createManualTransaction,
  createManualTransactions,
  updateManualTransaction,
  deleteManualTransaction,
} from "../repositories/manualTransactionRepository.js";
import { getCachedAccounts, listPortfolios } from "../models/db.js";
import { manualTransactionSchema, MANUAL_TRANSACTION_TYPES } from "../schemas/manualTransactionSchema.js";
import { parseCsvRecords } from "../utils/csv.js";
import { logger } from "../utils/logger.js";

// A statement export is a modest text file; anything larger is a mistake and
// would be parsed entirely into memory.
const MAX_IMPORT_ROWS = 5000;

/** Account ids that actually exist, so a row can't be filed against a typo. */
function knownAccountIds(): Set<string> {
  const ids = new Set<string>();
  for (const portfolio of listPortfolios()) {
    for (const account of getCachedAccounts(portfolio.id!)) ids.add(account.id);
  }
  return ids;
}

// GET /api/manual-transactions?accountId=xyz
export const listManualTransactionsHandler = (req: Request, res: Response) => {
  const accountId = typeof req.query.accountId === "string" && req.query.accountId.trim()
    ? req.query.accountId.trim()
    : undefined;
  res.json(listManualTransactions(accountId));
};

// POST /api/manual-transactions   (body validated by validateBody)
export const createManualTransactionHandler = (req: Request, res: Response) => {
  const body = req.body;
  if (!knownAccountIds().has(body.accountId)) {
    return res.status(400).json({ error: `Unknown account: ${body.accountId}` });
  }
  res.status(201).json(createManualTransaction(body));
};

// PATCH /api/manual-transactions/:id
export const updateManualTransactionHandler = (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

  const body = req.body;
  if (!knownAccountIds().has(body.accountId)) {
    return res.status(400).json({ error: `Unknown account: ${body.accountId}` });
  }

  const updated = updateManualTransaction(id, body);
  if (!updated) return res.status(404).json({ error: "Transaction not found" });
  res.json(updated);
};

// DELETE /api/manual-transactions/:id
export const deleteManualTransactionHandler = (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
  if (!deleteManualTransaction(id)) return res.status(404).json({ error: "Transaction not found" });
  res.json({ success: true });
};

/** Header aliases, so a broker's own column names usually import unchanged. */
const FIELD_ALIASES: Record<string, string[]> = {
  date:         ["date", "tradedate", "settlementdate", "transactiondate"],
  type:         ["type", "action", "activity", "transactiontype"],
  symbol:       ["symbol", "ticker", "security"],
  units:        ["units", "quantity", "qty", "shares"],
  price:        ["price", "unitprice", "priceperunit", "pricepershare"],
  amount:       ["amount", "total", "netamount", "value", "grossamount"],
  currencyCode: ["currencycode", "currency", "ccy"],
  description:  ["description", "name", "details"],
  notes:        ["notes", "note", "memo"],
};

function pick(record: Record<string, string>, field: string): string | undefined {
  for (const alias of FIELD_ALIASES[field] ?? [field]) {
    const v = record[alias];
    if (v != null && v !== "") return v;
  }
  return undefined;
}

/** Strip currency symbols, thousands separators and parenthesised negatives. */
function cleanNumber(raw: string | undefined): string | undefined {
  if (raw == null) return undefined;
  const negative = /^\(.*\)$/.test(raw.trim());
  const cleaned = raw.replace(/[()]/g, "").replace(/[^0-9.\-]/g, "").trim();
  if (cleaned === "" || cleaned === "-") return undefined;
  return negative ? `-${cleaned}` : cleaned;
}

/**
 * POST /api/manual-transactions/import
 * Body: { accountId, csv }
 *
 * Validates every row through the same schema as single entry and reports
 * per-row errors. Nothing is written unless every row passes — a half-imported
 * statement is worse than none, because the user can't tell which trades made
 * it in and re-importing would double them.
 */
export const importManualTransactionsHandler = (req: Request, res: Response) => {
  const { accountId, csv } = req.body ?? {};

  if (typeof accountId !== "string" || !accountId.trim()) {
    return res.status(400).json({ error: "accountId is required" });
  }
  if (typeof csv !== "string" || !csv.trim()) {
    return res.status(400).json({ error: "csv is required" });
  }
  if (!knownAccountIds().has(accountId)) {
    return res.status(400).json({ error: `Unknown account: ${accountId}` });
  }

  const { headers, records } = parseCsvRecords(csv);
  if (records.length === 0) {
    return res.status(400).json({ error: "No data rows found. The first line must be a header row." });
  }
  if (records.length > MAX_IMPORT_ROWS) {
    return res.status(400).json({ error: `Too many rows (${records.length}); the limit is ${MAX_IMPORT_ROWS}` });
  }

  const parsed: any[] = [];
  const errors: { row: number; message: string }[] = [];

  records.forEach((record, i) => {
    const candidate = {
      accountId,
      date: pick(record, "date"),
      type: (pick(record, "type") ?? "").toUpperCase().replace(/[\s-]+/g, "_"),
      symbol: pick(record, "symbol"),
      units: cleanNumber(pick(record, "units")),
      price: cleanNumber(pick(record, "price")),
      amount: cleanNumber(pick(record, "amount")),
      currencyCode: pick(record, "currencyCode"),
      description: pick(record, "description"),
      notes: pick(record, "notes"),
    };

    // A negative quantity in an export means a sale; the schema takes a
    // positive quantity and reads direction from the type.
    if (candidate.units?.startsWith("-")) candidate.units = candidate.units.slice(1);

    const result = manualTransactionSchema.safeParse(candidate);
    if (result.success) {
      parsed.push(result.data);
    } else {
      const detail = result.error.issues
        .map(issue => `${issue.path.join(".") || "row"} ${issue.message}`)
        .join("; ");
      errors.push({ row: i + 2, message: detail });   // +2: 1-indexed, past the header
    }
  });

  if (errors.length > 0) {
    logger.warn("ManualTxn", `CSV import rejected — ${errors.length} of ${records.length} row(s) invalid`);
    return res.status(400).json({
      error: `${errors.length} of ${records.length} row(s) could not be imported. Nothing was saved.`,
      headers,
      errors: errors.slice(0, 20),
      totalErrors: errors.length,
      supportedTypes: MANUAL_TRANSACTION_TYPES,
    });
  }

  const imported = createManualTransactions(parsed);
  logger.info("ManualTxn", `Imported ${imported} transaction(s) into account ${accountId}`);
  res.status(201).json({ imported, accountId });
};

// GET /api/manual-transactions/template.csv — a starter file with the expected columns.
export const importTemplateHandler = (_req: Request, res: Response) => {
  const csv = [
    "date,type,symbol,units,price,amount,currency,description,notes",
    "2021-06-15,BUY,ENB.TO,100,45.20,4520.00,CAD,Enbridge Inc,Pre-connection purchase",
    "2022-03-01,TRANSFER_IN,VFV.TO,50,88.10,4405.00,CAD,Vanguard S&P 500,In-kind transfer from RRSP",
    "2023-11-20,DIVIDEND,ENB.TO,,,88.75,CAD,Quarterly dividend,",
  ].join("\n");
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="manual-transactions-template.csv"');
  res.send("﻿" + csv);
};
