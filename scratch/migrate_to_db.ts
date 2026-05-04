import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { getSettings, saveSettings } from "../src/db.js";

const CREDS_PATH = resolve(process.cwd(), "user-credentials.json");

async function migrate() {
  if (!existsSync(CREDS_PATH)) {
    console.log("No user-credentials.json found. Skipping migration.");
    return;
  }

  try {
    const json = JSON.parse(readFileSync(CREDS_PATH, "utf8"));
    const settings = getSettings();

    if (settings) {
      console.log(`Migrating secret for userId: ${json.userId}`);
      // Update existing settings with the secret from JSON
      saveSettings({
        ...settings,
        userSecret: json.userSecret
      });
      console.log("✓ Successfully migrated userSecret to snaptrade.db");
    } else {
      console.warn("No settings found in DB. Please configure via UI first.");
    }
  } catch (err) {
    console.error("Migration failed:", err);
  }
}

migrate();
