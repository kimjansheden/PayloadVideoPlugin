import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import dotenv from "dotenv";

import type { VideoPluginOptions } from "../types";

type CliOptions = {
  configPath?: string;
  payloadConfigPath?: string;
  staticDir?: string;
  envFiles: string[];
  loadDefaultEnv: boolean;
  showHelp?: boolean;
};

const helpText = `
payload-video-worker

Start the Payload video processing worker using the same options you pass to the plugin.

Usage:
  payload-video-worker --config ./dist-config/videoPluginOptions.js [options]

Options:
  -c, --config <path>          Path to a module exporting the worker options (defaults to PAYLOAD_VIDEO_WORKER_CONFIG)
  -p, --payload-config <path>  Path to a Payload config file for local execution (sets PAYLOAD_CONFIG_PATH)
  -s, --static-dir <path>      Override STATIC_DIR before starting the worker
  -e, --env <path>             Load additional .env file (can be repeated)
      --no-default-env         Skip automatic loading of .env, .env.local, .env.development, .env.production
  -h, --help                   Show this message and exit
`.trim();

const parseArgs = (argv: string[]): CliOptions => {
  const options: CliOptions = {
    envFiles: [],
    loadDefaultEnv: true,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    switch (arg) {
      case "-c":
      case "--config": {
        const next = argv[index + 1];
        if (!next) {
          throw new Error("Missing value for --config option.");
        }
        options.configPath = next;
        index += 1;
        break;
      }
      case "-p":
      case "--payload-config": {
        const next = argv[index + 1];
        if (!next) {
          throw new Error("Missing value for --payload-config option.");
        }
        options.payloadConfigPath = next;
        index += 1;
        break;
      }
      case "-s":
      case "--static-dir": {
        const next = argv[index + 1];
        if (!next) {
          throw new Error("Missing value for --static-dir option.");
        }
        options.staticDir = next;
        index += 1;
        break;
      }
      case "-e":
      case "--env": {
        const next = argv[index + 1];
        if (!next) {
          throw new Error("Missing value for --env option.");
        }
        options.envFiles.push(next);
        index += 1;
        break;
      }
      case "--no-default-env": {
        options.loadDefaultEnv = false;
        break;
      }
      case "-h":
      case "--help": {
        options.showHelp = true;
        break;
      }
      default: {
        if (arg.startsWith("-")) {
          throw new Error(
            `Unknown option \`${arg}\`. Use --help to list supported flags.`,
          );
        }
        options.envFiles.push(arg);
      }
    }
  }

  return options;
};

const printHelp = () => {
  console.log(helpText);
};

const resolvePath = (input: string): string =>
  path.isAbsolute(input) ? input : path.resolve(process.cwd(), input);

const loadEnvFile = (filePath: string) => {
  const resolved = resolvePath(filePath);
  if (!fs.existsSync(resolved)) {
    return false;
  }

  dotenv.config({ path: resolved, override: false });
  console.log(`[video-processor] Loaded env file ${resolved}`);
  return true;
};

const ensureEnvVariables = () => {
  if (!process.env.MONGODB_URI && process.env.DATABASE_URI) {
    process.env.MONGODB_URI = process.env.DATABASE_URI;
  }

  if (!process.env.PAYLOAD_SECRET) {
    process.env.PAYLOAD_SECRET = "dev-secret";
  }
};

const toModuleUrl = (input: string): string =>
  pathToFileURL(resolvePath(input)).href;

const loadWorkerOptions = async (
  modulePath: string,
): Promise<VideoPluginOptions> => {
  const moduleUrl = toModuleUrl(modulePath);
  const imported = await import(moduleUrl);
  const value = imported?.default ?? imported;

  if (!value || typeof value !== "object") {
    throw new Error(
      `Worker options module at ${modulePath} did not export a configuration object.`,
    );
  }

  return value as VideoPluginOptions;
};

void (async () => {
  try {
    const options = parseArgs(process.argv.slice(2));

    if (options.showHelp) {
      printHelp();
      process.exit(0);
    }

    const defaultEnvFiles = [
      ".env",
      ".env.local",
      ".env.development",
      ".env.production",
    ];

    if (options.loadDefaultEnv) {
      for (const candidate of defaultEnvFiles) {
        loadEnvFile(candidate);
      }
    }

    for (const envFile of options.envFiles) {
      loadEnvFile(envFile);
    }

    if (options.staticDir) {
      process.env.STATIC_DIR = resolvePath(options.staticDir);
      console.log(
        `[video-processor] Using STATIC_DIR=${process.env.STATIC_DIR}`,
      );
    }

    if (options.payloadConfigPath) {
      const resolvedPayloadConfig = resolvePath(options.payloadConfigPath);
      process.env.PAYLOAD_CONFIG_PATH = resolvedPayloadConfig;
      console.log(
        `[video-processor] Using PAYLOAD_CONFIG_PATH=${resolvedPayloadConfig}`,
      );
    }

    const configPath =
      options.configPath ?? process.env.PAYLOAD_VIDEO_WORKER_CONFIG;

    if (!configPath) {
      throw new Error(
        "No worker config provided. Pass --config or set PAYLOAD_VIDEO_WORKER_CONFIG.",
      );
    }

    process.env.PAYLOAD_VIDEO_WORKER_CONFIG = resolvePath(configPath);

    ensureEnvVariables();

    const workerOptions = await loadWorkerOptions(
      process.env.PAYLOAD_VIDEO_WORKER_CONFIG,
    );

    const { createWorker } = await import("../queue/createWorker");
    await createWorker(workerOptions);
  } catch (error) {
    if (error instanceof Error) {
      console.error("[video-processor] Worker failed to start:", error.message);
      if (error.stack) {
        console.error(error.stack);
      }
    } else {
      console.error("[video-processor] Worker failed to start:", error);
    }
    process.exit(1);
  }
})();
