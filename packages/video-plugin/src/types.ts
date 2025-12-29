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
  args: string[];
  label?: string;
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

export type VideoPluginOptions = {
  presets: Record<string, Preset>;
  queue?: QueueConfig;
  access?: AccessControl;
  resolvePaths?: (args: ResolvePathsArgs) => ResolvePathsResult;
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
