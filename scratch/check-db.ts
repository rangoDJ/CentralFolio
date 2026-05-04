import { getSettings } from "../src/db.js";
const s = getSettings();
console.log("Settings:", JSON.stringify(s, null, 2));
if (s) {
    console.log("ClientId set:", !!s.clientId);
    console.log("ConsumerKey set:", !!s.consumerKey);
    console.log("UserId set:", !!s.userId);
    console.log("UserSecret set:", !!s.userSecret);
} else {
    console.log("No settings found in DB.");
}
