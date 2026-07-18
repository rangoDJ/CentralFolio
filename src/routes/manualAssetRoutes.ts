import { Router } from "express";
import {
  getManualAssets,
  getManualAssetsSummary,
  addManualAsset,
  editManualAsset,
  removeManualAsset,
} from "../controllers/manualAssetController.js";
import { validateBody } from "../middleware/validate.js";
import { manualAssetSchema } from "../schemas/manualAssetSchema.js";

const router = Router();

router.get("/", getManualAssets);
router.get("/summary", getManualAssetsSummary);
router.post("/", validateBody(manualAssetSchema), addManualAsset);
router.patch("/:id", validateBody(manualAssetSchema), editManualAsset);
router.delete("/:id", removeManualAsset);

export default router;
