import { getPayload } from "payload";
import config from "./payload.config.js";

// Initialize Payload
const start = async (): Promise<void> => {
  console.log("[example-payload] Initializing Payload (local API only)...");
  console.log("[example-payload] Note: this app does NOT start a /admin UI.");

  try {
    // Initialize Payload with the config
    const payload = await getPayload({
      config,
    });

    console.log("[example-payload] Payload initialized successfully!");
    console.log("[example-payload] You can now run:");
    console.log("  - pnpm worker  (separate process)");
    console.log("  - pnpm demo    (creates upload + waits for variants)");

    // Example: Create a test user if none exists
    const users = await payload.find({
      collection: "users",
      limit: 1,
    });

    if (users.totalDocs === 0) {
      console.log(
        "[example-payload] No users found (expected unless you seed).",
      );
    } else {
      console.log(
        `[example-payload] Found ${users.totalDocs} user(s) in database`,
      );
    }

    await payload.destroy();
  } catch (error) {
    console.error("[example-payload] Failed to initialize Payload:", error);
    process.exit(1);
  }
};

start();
