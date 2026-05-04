import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.resolve(__dirname, "../snaptrade.db");
const db = new Database(dbPath);

const row = db.prepare("SELECT * FROM settings WHERE id = 1").get();
console.log(JSON.stringify(row, null, 2));
