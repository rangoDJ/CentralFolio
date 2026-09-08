import { Router } from "express";
import {
  getWatchlist,
  addWatchlist,
  updateWatchlistNotes,
  setWatchlistTargetsHandler,
  deleteWatchlist,
} from "../controllers/watchlistController.js";
import {
  getSymbolDividendGrowth,
  getHeldDividendGrowth,
} from "../controllers/dividendGrowthController.js";
import { validateBody } from "../middleware/validate.js";
import { addWatchlistSchema, watchlistTargetsSchema } from "../schemas/watchlistSchema.js";

const router = Router();

// Watchlist + dividend screener
router.get("/watchlist", getWatchlist);
router.post("/watchlist", validateBody(addWatchlistSchema), addWatchlist);
router.patch("/watchlist/:symbol", updateWatchlistNotes);
router.put("/watchlist/:symbol/targets", validateBody(watchlistTargetsSchema), setWatchlistTargetsHandler);
router.delete("/watchlist/:symbol", deleteWatchlist);

// Dividend-growth metrics
router.get("/dividend-growth", getHeldDividendGrowth);
router.get("/dividend-growth/:symbol", getSymbolDividendGrowth);

export default router;
