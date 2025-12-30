import "dotenv/config";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getPayload } from "payload";
import config from "../payload.config";
import videoPluginOptions from "../videoPluginOptions";

type DemoArgs = {
  file?: string;
  timeoutSeconds: number;
};

const parseArgs = (argv: string[]): DemoArgs => {
  const args: DemoArgs = {
    timeoutSeconds: 600,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value) continue;

    if (value === "--file") {
      args.file = argv[index + 1];
      index += 1;
      continue;
    }

    if (value === "--timeout") {
      const parsed = Number(argv[index + 1]);
      if (Number.isFinite(parsed) && parsed > 0) {
        args.timeoutSeconds = parsed;
      }
      index += 1;
      continue;
    }
  }

  return args;
};

const runCommand = async (command: string, args: string[]): Promise<void> => {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
    });

    child.on("error", (error) => reject(error));
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${command} exited with code ${code ?? "unknown"}`));
    });
  });
};

const resolveFfmpegBinary = (): string | null => {
  const envPath = process.env.FFMPEG_BIN?.trim();
  if (envPath) {
    return envPath;
  }

  try {
    const require = createRequire(import.meta.url);
    const pluginPkgPath =
      require.resolve("@kimjansheden/payload-video-processor/package.json");
    const pluginRequire = createRequire(pluginPkgPath);
    const ffmpegStatic = pluginRequire("ffmpeg-static") as unknown;
    if (typeof ffmpegStatic === "string" && ffmpegStatic.trim().length > 0) {
      return ffmpegStatic;
    }
  } catch {
    // ignore
  }

  return "ffmpeg";
};

const generateTestVideo = async (outputPath: string): Promise<boolean> => {
  const ffmpegBinary = resolveFfmpegBinary();
  if (!ffmpegBinary) {
    return false;
  }

  const commonArgs = [
    "-y",
    "-f",
    "lavfi",
    "-i",
    "testsrc=size=640x360:rate=25",
    "-t",
    "2",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
  ];

  try {
    await runCommand(ffmpegBinary, [
      ...commonArgs,
      "-c:v",
      "libx264",
      outputPath,
    ]);
    return true;
  } catch {
    try {
      await runCommand(ffmpegBinary, [
        ...commonArgs,
        "-c:v",
        "mpeg4",
        outputPath,
      ]);
      return true;
    } catch {
      return false;
    }
  }
};

const waitForVariant = async ({
  payload,
  id,
  preset,
  timeoutMs,
}: {
  payload: Awaited<ReturnType<typeof getPayload>>;
  id: string;
  preset: string;
  timeoutMs: number;
}): Promise<void> => {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const doc = (await payload.findByID({
      collection: "media",
      id,
      depth: 0,
    })) as any;

    const status = doc?.videoProcessingStatus;
    const variants = Array.isArray(doc?.variants) ? doc.variants : [];
    const match = variants.find((variant: any) => variant?.preset === preset);

    if (match) {
      const storedPath =
        typeof match.path === "string" ? match.path : undefined;
      if (storedPath) {
        await fs.stat(storedPath);
      }

      console.log("[example-payload] ✅ Variant generated:", {
        preset,
        url: match.url,
        path: match.path,
      });
      return;
    }

    if (status?.state === "completed") {
      const originalPath = typeof doc?.path === "string" ? doc.path : undefined;
      if (originalPath) {
        await fs.stat(originalPath);
      }

      console.log(
        "[example-payload] ✅ Processing completed (no matching variant record found).",
      );
      console.log(
        "[example-payload] If you enabled autoReplaceOriginal, this is expected.",
      );
      return;
    }

    if (status?.state === "failed") {
      throw new Error(
        `Video processing failed (jobId=${status.jobId ?? "unknown"})`,
      );
    }

    if (status?.state) {
      const progressLabel =
        typeof status.progress === "number" ? ` (${status.progress}%)` : "";
      console.log(
        `[example-payload] Waiting… state=${status.state}${progressLabel}`,
      );
    } else {
      console.log(
        "[example-payload] Waiting… (no status yet) — is the worker running?",
      );
    }

    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  throw new Error(
    "Timed out waiting for variant. Ensure MongoDB + Redis are running and start the worker in a separate terminal (`pnpm worker`).",
  );
};

const main = async (): Promise<void> => {
  const appRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
  );
  const args = parseArgs(process.argv.slice(2));

  const preset =
    typeof videoPluginOptions.autoEnqueuePreset === "string" &&
    videoPluginOptions.autoEnqueuePreset.trim().length > 0
      ? videoPluginOptions.autoEnqueuePreset
      : (Object.keys(videoPluginOptions.presets)[0] ?? "mobile360");

  const tmpDir = path.join(appRoot, "tmp");
  await fs.mkdir(tmpDir, { recursive: true });

  let inputFile = args.file ? path.resolve(args.file) : "";
  if (!inputFile) {
    const generated = path.join(tmpDir, "demo.mp4");
    const ok = await generateTestVideo(generated);
    if (!ok) {
      throw new Error(
        "Unable to generate a test video. Provide one with: pnpm demo -- --file /absolute/path/to/video.mp4",
      );
    }
    inputFile = generated;
  }

  await fs.stat(inputFile);
  console.log("[example-payload] Using input file:", inputFile);
  console.log(`[example-payload] Expecting preset: ${preset}`);

  const payload = await getPayload({ config });

  const created = (await payload.create({
    collection: "media",
    data: {} as any,
    filePath: inputFile,
  })) as any;

  const id = String(created?.id ?? "");
  if (!id) {
    throw new Error("Failed to create media document (missing id).");
  }

  console.log("[example-payload] Created media doc:", {
    id,
    filename: created?.filename,
    url: created?.url,
  });

  await waitForVariant({
    payload,
    id,
    preset,
    timeoutMs: args.timeoutSeconds * 1000,
  });

  await payload.destroy();
};

void main().catch((error) => {
  console.error("[example-payload] demo failed", error);
  process.exit(1);
});
