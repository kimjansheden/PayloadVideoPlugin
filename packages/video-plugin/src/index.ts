import { ensureOptions, normalizePresets } from "./options";
import type {
  CollectionAfterChangeHook,
  CollectionAfterReadHook,
} from "payload";
import type {
  VideoPluginOptions,
  Preset,
  PayloadPluginFactory,
  PayloadConfig,
  VideoVariantFieldConfig,
  FieldConfig,
  CollectionConfig,
  VideoProcessingStatus,
} from "./types";
import { createQueue } from "./queue/createQueue";
import { createEnqueueHandler } from "./api/enqueue";
import { createStatusHandler } from "./api/status";
import { createRemoveVariantHandler } from "./api/removeVariant";
import { createReplaceOriginalHandler } from "./api/replaceOriginal";
import { buildPlaybackPosterUrl, buildPlaybackSources } from "./utils/playback";
export { createWorker } from "./queue/createWorker";
export { defaultResolvePaths } from "./utils/paths";
export type {
  Preset,
  VideoPluginOptions,
  VariantRecord,
  PlaybackSource,
  PayloadPluginFactory,
  PayloadConfig,
} from "./types";

// Client entry used by Payload's import map. The `client` export is a thin
// wrapper that re-exports the actual VideoField component so that Next can
// treat it as a proper client reference (`.../client#VideoField`), matching
// the pattern used by official Payload plugins.
const adminFieldPath =
  "@kimjansheden/payload-video-processor/client#VideoField";

type VideoDoc = Record<string, unknown> & { id: number | string };

const acceptsVideoUploads = (collection: CollectionConfig): boolean => {
  const upload = collection.upload;
  if (!upload) return false;

  if (upload === true) {
    return false;
  }

  const mimeTypes = Array.isArray(upload?.mimeTypes) ? upload.mimeTypes : [];
  return mimeTypes.some((type: string) => type.startsWith("video/"));
};

const getMimeType = (doc: Record<string, unknown>): string => {
  const mimeType = doc.mimeType;
  return typeof mimeType === "string" ? mimeType : "";
};

const getDocId = (doc: Record<string, unknown>): string | null => {
  const id = doc.id;
  if (typeof id === "string" || typeof id === "number") {
    return id.toString();
  }
  return null;
};

const resolveDefaultPresetName = (
  presets: Record<string, Preset>,
): string | null => {
  if (Object.prototype.hasOwnProperty.call(presets, "1080")) {
    return "1080";
  }
  if (Object.prototype.hasOwnProperty.call(presets, "hd1080")) {
    return "hd1080";
  }
  const [first] = Object.keys(presets);
  return first ?? null;
};

const resolveAutoEnqueuePresetName = (
  options: VideoPluginOptions,
  presets: Record<string, Preset>,
): string | null => {
  if (!options.autoEnqueue) {
    return null;
  }

  const requested =
    typeof options.autoEnqueuePreset === "string"
      ? options.autoEnqueuePreset.trim()
      : "";
  if (requested) {
    return presets[requested] ? requested : null;
  }

  const fallback = resolveDefaultPresetName(presets);
  return fallback && presets[fallback] ? fallback : null;
};

const buildProcessingStatus = ({
  jobId,
  preset,
  state,
  progress,
}: {
  jobId: string;
  preset: string;
  state: VideoProcessingStatus["state"];
  progress?: number;
}): VideoProcessingStatus => ({
  jobId,
  preset,
  state,
  progress,
  updatedAt: new Date().toISOString(),
});

const createVariantsField = (): FieldConfig => ({
  name: "variants",
  type: "array",
  label: "Video variants",
  admin: {
    readOnly: true,
  },
  defaultValue: [],
  fields: [
    {
      name: "preset",
      label: "Preset",
      type: "text",
      admin: { readOnly: true },
    },
    {
      name: "url",
      label: "URL",
      type: "text",
      admin: { readOnly: true },
    },
    {
      name: "path",
      label: "Path",
      type: "text",
      admin: { readOnly: true },
    },
    {
      name: "size",
      label: "Size (bytes)",
      type: "number",
      admin: { readOnly: true },
    },
    {
      name: "duration",
      label: "Duration (s)",
      type: "number",
      admin: { readOnly: true },
    },
    {
      name: "width",
      label: "Width",
      type: "number",
      admin: { readOnly: true },
    },
    {
      name: "height",
      label: "Height",
      type: "number",
      admin: { readOnly: true },
    },
    {
      name: "bitrate",
      label: "Bitrate",
      type: "number",
      admin: { readOnly: true },
    },
    {
      name: "createdAt",
      label: "Created",
      type: "date",
      admin: { readOnly: true },
    },
  ],
});

const createProcessingStatusField = (): FieldConfig => ({
  name: "videoProcessingStatus",
  type: "group",
  label: "Video processing status",
  admin: { readOnly: true, hidden: true },
  fields: [
    {
      name: "jobId",
      type: "text",
      admin: { readOnly: true },
    },
    {
      name: "preset",
      type: "text",
      admin: { readOnly: true },
    },
    {
      name: "state",
      type: "text",
      admin: { readOnly: true },
    },
    {
      name: "progress",
      type: "number",
      admin: { readOnly: true },
    },
    {
      name: "updatedAt",
      type: "date",
      admin: { readOnly: true },
    },
  ],
});

const buildAdminPresetMap = (presets: Record<string, Preset>) =>
  Object.fromEntries(
    Object.entries(presets).map(([name, preset]) => [
      name,
      {
        label: preset.label ?? name,
        enableCrop: Boolean(preset.enableCrop),
      },
    ]),
  );

const trimTrailingSlash = (value: string): string =>
  value.endsWith("/") ? value.slice(0, -1) : value;

// In Payload, custom endpoints are mounted under `config.routes.api` automatically.
// Paths provided here should be relative to that base (i.e., do NOT include `/api`).
const getApiBasePath = (_config: PayloadConfig): string => "";

const pluginFactory = (
  rawOptions: VideoPluginOptions,
): PayloadPluginFactory => {
  const options = ensureOptions(rawOptions);
  const presets = normalizePresets(options.presets);
  const autoEnqueuePresetName = resolveAutoEnqueuePresetName(options, presets);

  const plugin: PayloadPluginFactory = (config: PayloadConfig) => {
    const queueName = options.queue?.name ?? "video-transcode";
    const redisUrl = options.queue?.redisUrl ?? process.env.REDIS_URL;
    const apiBase = getApiBasePath(config); // empty string; paths are relative to the API base
    const endpointEnqueuePath = `${apiBase}/video-queue/enqueue`;
    const endpointStatusBase = `${apiBase}/video-queue/status`;
    const endpointReplaceOriginalPath = `${apiBase}/video-queue/replace-original`;
    const endpointRemoveVariantPath = `${apiBase}/video-queue/remove-variant`;

    const routesApiBase = trimTrailingSlash(config.routes?.api ?? "/api");
    const clientEnqueuePath = `${routesApiBase}/video-queue/enqueue`;
    const clientStatusBase = `${routesApiBase}/video-queue/status`;
    const clientReplaceOriginalPath = `${routesApiBase}/video-queue/replace-original`;
    const clientRemoveVariantPath = `${routesApiBase}/video-queue/remove-variant`;

    console.log(
      `[payload-video-processor] enabled (queue: ${queueName}, presets: ${Object.keys(presets).length})`,
    );
    if (options.autoEnqueue && !autoEnqueuePresetName) {
      console.warn(
        `[payload-video-processor] autoEnqueue enabled but no valid preset found. Available presets: ${Object.keys(presets).join(", ")}`,
      );
    }

    const queueRef: { queue?: ReturnType<typeof createQueue> } = {};
    const getQueue = () => {
      if (!queueRef.queue) {
        queueRef.queue = createQueue({ name: queueName, redisUrl });
      }
      return queueRef.queue.queue;
    };

    const collections = (config.collections ?? []).map(
      (collection: CollectionConfig) => {
        if (!acceptsVideoUploads(collection)) {
          return collection;
        }

        const fields: FieldConfig[] = [...(collection.fields ?? [])];

        const hasVariantsField = fields.some(
          (field) => "name" in field && field.name === "variants",
        );
        if (!hasVariantsField) {
          fields.push(createVariantsField());
        }

        const hasProcessingStatusField = fields.some(
          (field) => "name" in field && field.name === "videoProcessingStatus",
        );
        if (!hasProcessingStatusField) {
          fields.push(createProcessingStatusField());
        }

        const hasControlField = fields.some(
          (field) => "name" in field && field.name === "videoProcessing",
        );
        if (!hasControlField) {
          const clientProps = {
            presets: buildAdminPresetMap(presets),
            enqueuePath: clientEnqueuePath,
            statusPath: clientStatusBase,
            replaceOriginalPath: clientReplaceOriginalPath,
            removeVariantPath: clientRemoveVariantPath,
            queueName,
            collectionSlug: collection.slug,
          } satisfies VideoVariantFieldConfig;

          const controlField: FieldConfig = {
            name: "videoProcessing",
            type: "ui",
            label: "Video processing",
            admin: {
              components: {
                Field: {
                  path: adminFieldPath,
                  clientProps,
                },
              },
              position: "sidebar",
            },
            custom: clientProps,
          };
          fields.push(controlField);
        }

        const existingHooks = collection.hooks ?? {};
        const existingAfterRead = Array.isArray(existingHooks.afterRead)
          ? existingHooks.afterRead
          : [];
        const existingAfterChange = Array.isArray(existingHooks.afterChange)
          ? existingHooks.afterChange
          : [];

        const afterReadHook: CollectionAfterReadHook<VideoDoc> = ({
          doc,
          req,
        }) => {
          const docRecord: Record<string, unknown> = doc;
          const mimeType = getMimeType(docRecord);
          if (!mimeType.startsWith("video/")) {
            return doc;
          }

          docRecord.playbackSources = buildPlaybackSources({
            doc: docRecord,
            req,
          });

          const posterUrl = buildPlaybackPosterUrl({ doc: docRecord, req });

          if (posterUrl) {
            docRecord.playbackPosterUrl = posterUrl;
          }

          return doc;
        };

        const afterChangeHook: CollectionAfterChangeHook<VideoDoc> = async ({
          doc,
          operation,
          req,
        }) => {
          if (!options.autoEnqueue || !autoEnqueuePresetName) {
            return doc;
          }

          if (operation !== "create") {
            return doc;
          }

          const docRecord: Record<string, unknown> = doc;
          const mimeType = getMimeType(docRecord);
          if (!mimeType.startsWith("video/")) {
            return doc;
          }

          const docId = getDocId(docRecord);
          if (!docId) {
            return doc;
          }

          if (options.access?.enqueue) {
            const allowed = await options.access.enqueue({ req });
            if (!allowed) {
              return doc;
            }
          }

          try {
            const queue = getQueue();
            const jobData = {
              collection: collection.slug,
              id: docId,
              preset: autoEnqueuePresetName,
              ...(options.autoReplaceOriginal
                ? { autoReplaceOriginal: true }
                : {}),
            };
            const job = await queue.add(autoEnqueuePresetName, jobData, {
              removeOnComplete: { age: 60 },
              removeOnFail: false,
            });
            const jobId =
              typeof job.id === "string" || typeof job.id === "number"
                ? String(job.id)
                : "";
            if (jobId) {
              await req.payload.update({
                collection: collection.slug,
                id: docId,
                data: {
                  videoProcessingStatus: buildProcessingStatus({
                    jobId,
                    preset: autoEnqueuePresetName,
                    state: "queued",
                    progress: 0,
                  }),
                },
                overrideAccess: true,
              });
            }
          } catch (error) {
            console.error(
              "[payload-video-processor] auto-enqueue failed",
              error,
            );
          }

          return doc;
        };

        const hooks = {
          ...existingHooks,
          afterRead: [...existingAfterRead, afterReadHook],
          afterChange: [...existingAfterChange, afterChangeHook],
        } satisfies CollectionConfig["hooks"];

        return {
          ...collection,
          fields,
          hooks,
        } satisfies CollectionConfig;
      },
    );

    const endpoints = [
      {
        method: "post",
        path: endpointEnqueuePath,
        handler: createEnqueueHandler({
          getQueue,
          presets,
          access: options.access,
        }),
      },
      {
        method: "get",
        path: `${endpointStatusBase}/:jobId`,
        handler: createStatusHandler({ getQueue }),
      },
      {
        method: "post",
        path: endpointReplaceOriginalPath,
        handler: createReplaceOriginalHandler({ access: options.access }),
      },
      {
        method: "post",
        path: endpointRemoveVariantPath,
        handler: createRemoveVariantHandler({ access: options.access }),
      },
    ] satisfies NonNullable<PayloadConfig["endpoints"]>;

    const existingEndpoints = Array.isArray(config.endpoints)
      ? config.endpoints
      : [];

    return {
      ...config,
      collections,
      endpoints: [...existingEndpoints, ...endpoints],
    };
  };

  return plugin;
};

export default pluginFactory;
