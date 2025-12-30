import path from "node:path";
import { mkdir, stat, rm, rename } from "node:fs/promises";
import ffmpeg from "fluent-ffmpeg";
import ffmpegStatic from "ffmpeg-static";
import ffprobeStatic from "ffprobe-static";
import { Worker } from "bullmq";
import IORedis from "ioredis";
import type {
  VideoPluginOptions,
  VariantRecord,
  VideoProcessingStatus,
} from "../types";
import { ensureOptions } from "../options";
import { videoJobSchema, type VideoJobData } from "./job.types";
import { buildFfmpegArgs } from "../ffmpeg/args";
import { probeVideo } from "../ffmpeg/probe";
import {
  buildStoredPath,
  buildWritePath,
  defaultResolvePaths,
} from "../utils/paths";
import { getPayloadClient } from "../utils/payload";
import { gatherAllowedRoots, resolveAbsolutePath } from "../utils/filesystem";

const envFfmpegPath = process.env.FFMPEG_BIN?.trim();
const ffmpegBinary =
  envFfmpegPath && envFfmpegPath.length > 0
    ? envFfmpegPath
    : typeof ffmpegStatic === "string"
      ? ffmpegStatic
      : null;
if (ffmpegBinary) {
  ffmpeg.setFfmpegPath(ffmpegBinary);
}
if (ffprobeStatic.path) {
  ffmpeg.setFfprobePath(ffprobeStatic.path);
}

export const createWorker = async (
  rawOptions: VideoPluginOptions,
): Promise<Worker<VideoJobData>> => {
  const options = ensureOptions(rawOptions);
  const presets = options.presets;
  const queueName = options.queue?.name ?? "video-transcode";
  const concurrency = options.queue?.concurrency ?? 1;
  const redisUrl = options.queue?.redisUrl ?? process.env.REDIS_URL;

  const connection = redisUrl
    ? new IORedis(redisUrl, { maxRetriesPerRequest: null })
    : new IORedis({ maxRetriesPerRequest: null });

  const worker = new Worker<VideoJobData>(
    queueName,
    async (job) => {
      const parsed = videoJobSchema.parse(job.data);
      const preset = presets[parsed.preset];
      if (!preset) {
        throw new Error(`Unknown preset ${parsed.preset}`);
      }

      const jobId =
        typeof job.id === "string" || typeof job.id === "number"
          ? String(job.id)
          : "";

      const client = await getPayloadClient();
      const updateProcessingStatus = async (
        state: VideoProcessingStatus["state"],
        progress?: number,
      ) => {
        if (!jobId) return;
        const status: VideoProcessingStatus = {
          jobId,
          preset: parsed.preset,
          state,
          progress,
          updatedAt: new Date().toISOString(),
        };
        try {
          await client.update({
            collection: parsed.collection,
            id: parsed.id,
            data: { videoProcessingStatus: status },
          });
        } catch (error) {
          console.warn(
            "[video-processor] Failed to update processing status",
            error,
          );
        }
      };

      const readString = (value: unknown): string | undefined => {
        if (typeof value !== "string") return undefined;
        const trimmed = value.trim();
        return trimmed.length > 0 ? trimmed : undefined;
      };

      try {
        const document = await client.findByID({
          collection: parsed.collection,
          id: parsed.id,
        });

        if (!document || typeof document !== "object") {
          throw new Error(
            `Document ${parsed.id} in collection ${parsed.collection} not found`,
          );
        }

        const documentRecord = document as Record<string, unknown>;
        const originalPath = readString(documentRecord.path);
        const filename = readString(documentRecord.filename);
        const url = readString(documentRecord.url);

        if (!originalPath) {
          throw new Error("Source document does not expose a `path` property.");
        }

        job.updateProgress(5);
        await updateProcessingStatus("processing", 5);

        const absoluteInputPath = path.isAbsolute(originalPath)
          ? originalPath
          : path.join(process.cwd(), originalPath);

        const inputMetadata = await probeVideo(absoluteInputPath);
        job.updateProgress(15);

        const resolvePaths = options.resolvePaths ?? defaultResolvePaths;
        const collectionConfig =
          client.getCollectionConfig?.(parsed.collection) ?? null;

        const resolved = resolvePaths({
          doc: documentRecord,
          collection: collectionConfig,
          collectionSlug: parsed.collection,
          original: {
            filename: filename ?? path.basename(originalPath),
            path: originalPath,
            url: url ?? "",
          },
          presetName: parsed.preset,
        });

        const writeDir = resolved.dir;
        const writeFilename = resolved.filename;
        const targetUrl = resolved.url;
        const writePath = buildWritePath(writeDir, writeFilename);

        await mkdir(writeDir, { recursive: true });

        const { globalOptions, outputOptions } = buildFfmpegArgs({
          presetArgs: preset.args,
          crop: parsed.crop,
          dimensions: {
            width: inputMetadata.width,
            height: inputMetadata.height,
          },
        });

        await new Promise<void>((resolve, reject) => {
          const command = ffmpeg(absoluteInputPath);
          globalOptions.forEach((option) => command.addOption(option));
          command.outputOptions(outputOptions);
          command.output(writePath);
          command.on("progress", (progress) => {
            if (typeof progress.percent === "number") {
              const bounded = Math.min(95, 15 + progress.percent * 0.7);
              void job.updateProgress(bounded);
            }
          });
          command.on("end", () => resolve());
          command.on("error", (error) => reject(error));
          command.run();
        });

        const fileStats = await stat(writePath);
        const outputMetadata = await probeVideo(writePath);

        const storedPath = buildStoredPath(originalPath, writeFilename);
        const variant: VariantRecord = {
          preset: parsed.preset,
          url: targetUrl,
          path: storedPath,
          size: fileStats.size,
          duration: outputMetadata.duration ?? inputMetadata.duration,
          width: outputMetadata.width ?? inputMetadata.width,
          height: outputMetadata.height ?? inputMetadata.height,
          bitrate: outputMetadata.bitrate,
          createdAt: new Date().toISOString(),
        };

        const existingVariants: VariantRecord[] = Array.isArray(
          documentRecord.variants,
        )
          ? (documentRecord.variants as VariantRecord[])
          : [];

        const nextVariants = [
          ...existingVariants.filter((item) => item?.preset !== variant.preset),
          variant,
        ];

        const replaceOriginalWithVariant = async () => {
          const allowedRoots = gatherAllowedRoots({
            collection: collectionConfig,
            doc: documentRecord,
          });

          const variantPath = readString(variant.path);
          if (!variantPath) {
            throw new Error("Variant does not expose a file path.");
          }

          const resolvedVariantPath = resolveAbsolutePath(
            variantPath,
            allowedRoots,
          );
          if (!resolvedVariantPath) {
            throw new Error("Variant path is outside allowed directories.");
          }

          const resolvedOriginalPath = resolveAbsolutePath(
            originalPath,
            allowedRoots,
          );
          if (!resolvedOriginalPath) {
            throw new Error("Original file path could not be resolved.");
          }

          await rm(resolvedOriginalPath).catch(() => undefined);
          await mkdir(path.dirname(resolvedOriginalPath), { recursive: true });
          await rename(resolvedVariantPath, resolvedOriginalPath);

          const updateData: Record<string, unknown> = {
            variants: nextVariants.filter(
              (item) => item?.preset !== variant.preset,
            ),
          };

          if (typeof variant.size === "number") {
            updateData.filesize = variant.size;
          }
          if (typeof variant.duration === "number") {
            updateData.duration = variant.duration;
          }
          if (typeof variant.width === "number") {
            updateData.width = variant.width;
          }
          if (typeof variant.height === "number") {
            updateData.height = variant.height;
          }
          if (typeof variant.bitrate === "number") {
            updateData.bitrate = variant.bitrate;
          }

          await client.update({
            collection: parsed.collection,
            id: parsed.id,
            data: updateData,
          });
        };

        if (parsed.autoReplaceOriginal) {
          await replaceOriginalWithVariant();
        } else {
          await client.update({
            collection: parsed.collection,
            id: parsed.id,
            data: {
              variants: nextVariants,
            },
          });
        }

        await updateProcessingStatus("completed", 100);
        await job.updateProgress(100);

        return variant;
      } catch (error) {
        await updateProcessingStatus("failed");
        throw error;
      }
    },
    {
      connection,
      concurrency,
    },
  );

  worker.on("failed", (job, error) => {
    console.error(`[video-processor] Job ${job?.id} failed`, error);
  });

  worker.on("completed", (job) => {
    console.log(`[video-processor] Job ${job.id} completed`);
  });

  await worker.waitUntilReady();
  console.log(`[video-processor] Worker listening on queue ${queueName}`);

  const shutdown = async () => {
    await worker.close();
    await connection.quit();
  };

  process.once("SIGINT", () => {
    void shutdown().then(() => process.exit(0));
  });
  process.once("SIGTERM", () => {
    void shutdown().then(() => process.exit(0));
  });

  return worker;
};
