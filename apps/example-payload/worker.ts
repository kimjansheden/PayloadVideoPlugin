import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createWorker } from "@kimjansheden/payload-video-processor";
import options from "./videoPluginOptions";

const filename = fileURLToPath(import.meta.url);
const dirname = path.dirname(filename);

process.env.PAYLOAD_CONFIG_PATH =
  process.env.PAYLOAD_CONFIG_PATH ?? path.join(dirname, "payload.config.ts");

void createWorker(options).catch((error) => {
  console.error("[example-payload] worker failed", error);
  process.exit(1);
});
