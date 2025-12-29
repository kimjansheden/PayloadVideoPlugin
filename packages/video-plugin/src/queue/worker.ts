import path from "node:path";
import { pathToFileURL } from "node:url";
import type { VideoPluginOptions } from "../types";
import { createWorker } from "./createWorker";

const loadOptions = async (): Promise<VideoPluginOptions> => {
  const modulePath = process.env.PAYLOAD_VIDEO_WORKER_CONFIG;
  if (!modulePath) {
    throw new Error(
      "PAYLOAD_VIDEO_WORKER_CONFIG must point to a module exporting plugin options.",
    );
  }

  const resolved =
    modulePath.startsWith(".") || modulePath.startsWith("/")
      ? pathToFileURL(path.resolve(modulePath)).href
      : modulePath;

  const imported = await import(resolved);
  const options = (imported.default ?? imported) as VideoPluginOptions;

  if (!options || typeof options !== "object" || !("presets" in options)) {
    throw new Error(
      "Invalid worker options module. Ensure it exports VideoPluginOptions.",
    );
  }

  return options;
};

const main = async () => {
  const options = await loadOptions();
  await createWorker(options);
};

void main().catch((error) => {
  console.error("[video-processor] Worker failed to start", error);
  process.exit(1);
});
