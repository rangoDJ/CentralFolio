import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import portfolioRoutes from "./routes/portfolioRoutes.js";
import snapTradeRoutes from "./routes/snapTradeRoutes.js";
import adminRoutes from "./routes/adminRoutes.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const port = 3000;

app.use(express.json());
app.use(express.static(path.resolve(__dirname, "../public")));

// --- Routes ---
app.use("/api/portfolios", portfolioRoutes);
app.use("/api", snapTradeRoutes); // register, accounts, holdings, login
app.use("/api/admin", adminRoutes);

// Catch-all for API routes to avoid returning HTML
app.all(/^\/api\/.*/, (req, res) => {
  console.log(`[API] 404 Unhandled: ${req.method} ${req.url}`);
  res.status(404).json({ error: "API route not found" });
});

// Global error handler to ensure JSON responses for API routes
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (req.path.startsWith('/api/')) {
    console.error('[API] Global Error:', err);
    return res.status(500).json({ 
      error: "Internal Server Error", 
      detail: err.message || "An unexpected error occurred" 
    });
  }
  next(err);
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
