import { Request, Response } from "express";
import {
  listManualAssets,
  createManualAsset,
  updateManualAsset,
  deleteManualAsset,
} from "../repositories/manualAssetRepository.js";
import { getManualAssetSummary } from "../services/manualAssetService.js";
import type { ManualAssetInput } from "../schemas/manualAssetSchema.js";
import { logger } from "../utils/logger.js";

// GET /api/manual-assets — list all manual (off-brokerage) assets.
export const getManualAssets = (_req: Request, res: Response) => {
  try {
    res.json(listManualAssets());
  } catch (err: any) {
    logger.error("ManualAssets", `getManualAssets failed: ${err.message}`);
    res.status(500).json({ error: "Failed to load manual assets" });
  }
};

// GET /api/manual-assets/summary — FX-converted totals by category/currency.
export const getManualAssetsSummary = async (_req: Request, res: Response) => {
  try {
    res.json(await getManualAssetSummary());
  } catch (err: any) {
    logger.error("ManualAssets", `getManualAssetsSummary failed: ${err.message}`);
    res.status(500).json({ error: "Failed to summarize manual assets" });
  }
};

// POST /api/manual-assets — add a manual asset.
export const addManualAsset = (req: Request, res: Response) => {
  const input = req.body as ManualAssetInput;
  try {
    const asset = createManualAsset(input);
    res.status(201).json(asset);
  } catch (err: any) {
    logger.error("ManualAssets", `addManualAsset failed: ${err.message}`);
    res.status(500).json({ error: "Failed to add manual asset" });
  }
};

// PATCH /api/manual-assets/:id — update a manual asset.
export const editManualAsset = (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid asset id" });
  const input = req.body as ManualAssetInput;
  try {
    const asset = updateManualAsset(id, input);
    if (!asset) return res.status(404).json({ error: "Manual asset not found" });
    res.json(asset);
  } catch (err: any) {
    logger.error("ManualAssets", `editManualAsset(${id}) failed: ${err.message}`);
    res.status(500).json({ error: "Failed to update manual asset" });
  }
};

// DELETE /api/manual-assets/:id — remove a manual asset.
export const removeManualAsset = (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid asset id" });
  const removed = deleteManualAsset(id);
  if (!removed) return res.status(404).json({ error: "Manual asset not found" });
  res.json({ success: true });
};
