import { Router } from "express";
import {
  listBucketsHandler,
  createBucketHandler,
  updateBucketHandler,
  deleteBucketHandler,
  previewBucketHandler,
  stageBucketRunHandler,
  confirmBucketRunHandler,
} from "../controllers/bucketController.js";
import { searchSymbolsHandler } from "../controllers/symbolSearchController.js";
import { validateBody } from "../middleware/validate.js";
import { bucketSchema, bucketRunSchema, bucketConfirmSchema } from "../schemas/bucketSchema.js";

const router = Router();

// Ticker lookup for the bucket editor.
router.get("/symbols/search", searchSymbolsHandler);

router.get("/buckets", listBucketsHandler);
router.post("/buckets", validateBody(bucketSchema), createBucketHandler);
router.put("/buckets/:id", validateBody(bucketSchema), updateBucketHandler);
router.delete("/buckets/:id", deleteBucketHandler);

// Running a bucket: preview → stage (returns a token) → confirm (places).
router.post("/buckets/:id/preview", validateBody(bucketRunSchema), previewBucketHandler);
router.post("/buckets/:id/run", validateBody(bucketRunSchema), stageBucketRunHandler);
router.post("/buckets/run/confirm", validateBody(bucketConfirmSchema), confirmBucketRunHandler);

export default router;
