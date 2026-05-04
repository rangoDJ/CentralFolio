import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";
import { readFileSync, existsSync } from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.resolve(__dirname, "../snaptrade.db");
const db = new Database(dbPath);

const CREDS_PATH = path.resolve(__dirname, "../user-credentials.json");

if (existsSync(CREDS_PATH)) {
  const json = JSON.parse(readFileSync(CREDS_PATH, "utf8"));
  console.log(`Fixing DB with JSON credentials: userId=${json.userId}`);
  
  // We'll update the first row (or only row) with the correct userId and userSecret
  db.prepare(`
    UPDATE settings 
    SET userId = ?, userSecret = ?
    WHERE id = 1
  `).run(json.userId, json.userSecret);
  
  console.log("✓ DB updated with correct userId and userSecret.");
} else {
  console.log("user-credentials.json not found.");
}
