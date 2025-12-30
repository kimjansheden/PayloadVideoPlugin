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
  name?: string;
  redisUrl?: string;
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
  enqueue?: (args: AccessEnqueueArgs) => boolean | Promise<boolean>;
  replaceOriginal?: (args: AccessVariantArgs) => boolean | Promise<boolean>;
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

export type VideoPluginOptions<PresetName extends string = string> = {
  /**
   * Video presets keyed by name.
   */
  presets: Record<PresetName, Preset>;
  /**
   * Queue config for BullMQ.
   */
  queue?: QueueConfig;
  /**
   * Auto-enqueue a preset when a new video is created.
   * - false/undefined: disabled
   * - true: use the default preset (1080 -> hd1080 -> first preset)
   *
   * @example
   * autoEnqueue: true
   */
  autoEnqueue?: boolean;
  /**
   * Optional: override the default preset used when autoEnqueue is true.
   *
   * @example
   * autoEnqueuePreset: "hd1080"
   */
  autoEnqueuePreset?: PresetName;
  /**
   * Replace the original file after an auto-enqueued job finishes.
   */
  autoReplaceOriginal?: boolean;
  /**
   * Access control hooks for enqueue/remove/replace operations.
   */
  access?: AccessControl;
  /**
   * Customize file/URL resolution for generated variants.
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
