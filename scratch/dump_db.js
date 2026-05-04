import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.resolve(__dirname, "../snaptrade.db");

const db = new Database(dbPath);
const portfolios = db.prepare("SELECT * FROM portfolios").all();
console.log(JSON.stringify(portfolios, null, 2));
