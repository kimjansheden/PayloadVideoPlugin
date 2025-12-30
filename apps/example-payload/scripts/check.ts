import "dotenv/config";
import { getPayload } from "payload";
import config from "../payload.config";
import videoPluginOptions from "../videoPluginOptions";

const main = async (): Promise<void> => {
  const payload = await getPayload({ config });

  const presets = Object.keys(videoPluginOptions.presets);
  console.log("[example-payload] Connected.");
  console.log(`[example-payload] Presets: ${presets.join(", ")}`);

  const mediaCount = await payload.count({ collection: "media" });
  console.log(`[example-payload] media.count = ${mediaCount.totalDocs}`);

  await payload.destroy();
};

void main().catch((error) => {
  console.error("[example-payload] check failed", error);
  process.exit(1);
});
