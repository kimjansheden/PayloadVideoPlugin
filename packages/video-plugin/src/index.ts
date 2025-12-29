import { ensureOptions, normalizePresets } from "./options";
import type {
  VideoPluginOptions,
  Preset,
  PayloadPluginFactory,
  PayloadConfig,
  VideoVariantFieldConfig,
  FieldConfig,
  CollectionConfig,
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

const acceptsVideoUploads = (collection: CollectionConfig): boolean => {
  const upload = collection.upload;
  if (!upload) return false;

  if (upload === true) {
    return false;
  }

  const mimeTypes = Array.isArray(upload?.mimeTypes) ? upload.mimeTypes : [];
  return mimeTypes.some((type: string) => type.startsWith("video/"));
};

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

        const hooks = {
          ...existingHooks,
          afterRead: [
            ...existingAfterRead,
            ({ doc, req }: { doc: unknown; req?: unknown }) => {
              if (!doc || typeof doc !== "object") {
                return doc;
              }

              const mimeType =
                typeof (doc as any).mimeType === "string"
                  ? (doc as any).mimeType
                  : "";

              if (!mimeType.startsWith("video/")) {
                return doc;
              }

              (doc as any).playbackSources = buildPlaybackSources({
                doc: doc as Record<string, unknown>,
                req: req as any,
              });

              const posterUrl = buildPlaybackPosterUrl({
                doc: doc as Record<string, unknown>,
                req: req as any,
              });

              if (posterUrl) {
                (doc as any).playbackPosterUrl = posterUrl;
              }

              return doc;
            },
          ],
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
