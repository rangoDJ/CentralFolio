import { Router } from "express";
import {
  getWatchlist,
  addWatchlist,
  updateWatchlistNotes,
  deleteWatchlist,
} from "../controllers/watchlistController.js";
import {
  getSymbolDividendGrowth,
  getHeldDividendGrowth,
} from "../controllers/dividendGrowthController.js";
import { validateBody } from "../middleware/validate.js";
import { addWatchlistSchema } from "../schemas/watchlistSchema.js";

const router = Router();

// Watchlist + dividend screener
router.get("/watchlist", getWatchlist);
router.post("/watchlist", validateBody(addWatchlistSchema), addWatchlist);
router.patch("/watchlist/:symbol", updateWatchlistNotes);
router.delete("/watchlist/:symbol", deleteWatchlist);

// Dividend-growth metrics
router.get("/dividend-growth", getHeldDividendGrowth);
router.get("/dividend-growth/:symbol", getSymbolDividendGrowth);

export default router;
