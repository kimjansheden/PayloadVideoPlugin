import { getPayload } from "payload";
import config from "./payload.config.js";

// Initialize Payload
const start = async (): Promise<void> => {
  console.log("Starting Payload server...");

  try {
    // Initialize Payload with the config
    const payload = await getPayload({
      config,
    });

    console.log("Payload initialized successfully!");
    console.log("You can now:");
    console.log("1. Test the Local API programmatically");
    console.log("2. Use the REST API if you set up HTTP endpoints");
    console.log("3. Access your database directly through Payload");

    // Example: Create a test user if none exists
    const users = await payload.find({
      collection: "users",
      limit: 1,
    });

    if (users.totalDocs === 0) {
      console.log(
        "No users found. You may want to create one programmatically or through seeding.",
      );
    } else {
      console.log(`Found ${users.totalDocs} user(s) in database`);
    }
  } catch (error) {
    console.error("Failed to initialize Payload:", error);
    process.exit(1);
  }
};

start();
