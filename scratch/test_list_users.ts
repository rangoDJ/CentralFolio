import { listAllUsers } from "../src/client.js";

async function test() {
  try {
    const users = await listAllUsers();
    console.log("Users:", JSON.stringify(users, null, 2));
  } catch (err: any) {
    console.error("Error details:", err?.response?.data || err?.message || err);
    if (err?.response?.data) {
        console.error("Full error response:", JSON.stringify(err.response.data, null, 2));
    }
  }
}

test();
