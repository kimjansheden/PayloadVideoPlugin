import type {
  CollectionConfig as PayloadCollectionConfig,
  Config,
  Field,
  PayloadRequest,
  Plugin,
} from "payload";

export type CropRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type Preset = {
  /**
   * FFmpeg args for the preset, e.g. ["-vf", "scale=-2:720"].
   */
  args: string[];
  /**
   * Optional label shown in the admin UI.
   */
  label?: string;
  /**
   * Enable crop controls for this preset in the admin UI.
   */
  enableCrop?: boolean;
};

export type VariantRecord = {
  preset: string;
  url: string;
  path: string;
  size: number;
  duration?: number;
  width?: number;
  height?: number;
  bitrate?: number;
  createdAt: string;
};

export type PlaybackSource = {
  src: string;
  type?: string;
  preset?: string;
};

export type QueueConfig = {
  /**
   * Queue name for BullMQ.
   * Defaults to "video-transcode".
   */
  name?: string;
  /**
   * Redis connection string.
   * Falls back to process.env.REDIS_URL when omitted.
   */
  redisUrl?: string;
  /**
   * Number of concurrent workers for the queue.
   */
  concurrency?: number;
};

export type AccessEnqueueArgs = {
  req: PayloadRequest;
};

export type AccessVariantArgs = {
  req: PayloadRequest;
  collection: string;
  id: string;
  preset?: string;
  variantId?: string;
  variantIndex?: number;
};

export type AccessControl = {
  /**
   * Authorize enqueue requests.
   */
  enqueue?: (args: AccessEnqueueArgs) => boolean | Promise<boolean>;
  /**
   * Authorize "replace original" requests.
   */
  replaceOriginal?: (args: AccessVariantArgs) => boolean | Promise<boolean>;
  /**
   * Authorize "remove variant" requests.
   */
  removeVariant?: (args: AccessVariantArgs) => boolean | Promise<boolean>;
};

export type FieldConfig = Field;

export type CollectionConfig = PayloadCollectionConfig;

export type ResolvePathsArgs = {
  doc: unknown;
  collection: CollectionConfig | null;
  collectionSlug: string;
  original: {
    filename: string;
    path: string;
    url: string;
  };
  presetName: string;
};

export type ResolvePathsResult = {
  dir: string;
  filename: string;
  url: string;
};

/**
 * Options passed to the video plugin.
 *
 * @example
 * const presets = {
 *   mobile360: { label: "360p Mobile", args: ["-vf", "scale=-2:360"] },
 *   hd1080: { label: "Full HD 1080p", args: ["-vf", "scale=-2:1080"] },
 * } satisfies VideoPluginOptions["presets"];
 *
 * type PresetName = keyof typeof presets;
 *
 * const options: VideoPluginOptions<PresetName> = {
 *   presets,
 *   queue: { redisUrl: process.env.REDIS_URL, concurrency: 1 },
 *   autoEnqueue: true,
 *   autoEnqueuePreset: "hd1080",
 *   autoReplaceOriginal: true,
 * };
 */
export type VideoPluginOptions<PresetName extends string = string> = {
  /**
   * Video presets keyed by name.
   * Use `as const` + `keyof typeof presets` for type-safe preset names.
   */
  presets: Record<PresetName, Preset>;
  /**
   * Queue config for BullMQ.
   */
  queue?: QueueConfig;
  /**
   * Auto-enqueue a preset when a new video is created.
   * - false/undefined: disabled
   * - true: use autoEnqueuePreset when set, otherwise fall back to
   *   1080 -> hd1080 -> first preset.
   *
   * @example
   * autoEnqueue: true
   */
  autoEnqueue?: boolean;
  /**
   * Optional: override the default preset used when autoEnqueue is true.
   * Must match a preset key (not the label).
   *
   * @example
   * autoEnqueuePreset: "hd1080"
   */
  autoEnqueuePreset?: PresetName;
  /**
   * Replace the original file after an auto-enqueued job finishes.
   * This only applies to autoEnqueue jobs.
   */
  autoReplaceOriginal?: boolean;
  /**
   * Access control hooks for enqueue/remove/replace operations.
   */
  access?: AccessControl;
  /**
   * Customize file/URL resolution for generated variants.
   *
   * @example
   * resolvePaths: ({ original, presetName }) => ({
   *   dir: path.join("/data/videos", presetName),
   *   filename: `${path.parse(original.filename).name}.${presetName}.mp4`,
   *   url: `/videos/${presetName}/${path.parse(original.filename).name}.mp4`,
   * })
   */
  resolvePaths?: (args: ResolvePathsArgs) => ResolvePathsResult;
};

export type VideoProcessingStatus = {
  jobId: string;
  preset: string;
  state: "queued" | "processing" | "completed" | "failed";
  progress?: number;
  updatedAt: string;
};

export type VideoVariantFieldConfig = {
  presets: Record<
    string,
    {
      label: string;
      enableCrop: boolean;
    }
  >;
  queueName: string;
  enqueuePath: string;
  statusPath: string;
  removeVariantPath: string;
  replaceOriginalPath: string;
  collectionSlug: string;
};

export type PayloadEndpoint = NonNullable<Config["endpoints"]>[number];

export type PayloadConfig = Config;

export type PayloadPluginFactory = Plugin;
