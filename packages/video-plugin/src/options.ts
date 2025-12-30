import { z } from "zod";
import type { Preset, VideoPluginOptions } from "./types";

export const presetSchema = z.object({
  args: z.array(z.string()),
  label: z.string().optional(),
  enableCrop: z.boolean().optional(),
});

export const videoPluginOptionsSchema = z.object({
  presets: z
    .record(presetSchema)
    .refine((value) => Object.keys(value).length > 0, {
      message: "At least one preset must be defined.",
    }),
  queue: z
    .object({
      name: z.string().min(1).optional(),
      redisUrl: z.string().optional(),
      concurrency: z.number().int().positive().optional(),
    })
    .optional(),
  autoEnqueue: z.boolean().optional(),
  autoEnqueuePreset: z.string().min(1).optional(),
  autoReplaceOriginal: z.boolean().optional(),
  access: z.unknown().optional(),
  resolvePaths: z.unknown().optional(),
});

export type NormalizedPresets = Record<string, Preset>;

export const normalizePresets = <PresetName extends string>(
  presets: Record<PresetName, Preset>,
): Record<PresetName, Preset> => {
  const entries = (Object.entries(presets) as Array<[PresetName, Preset]>).map(
    ([name, preset]) => [name, { ...preset }],
  );
  return Object.fromEntries(entries) as Record<PresetName, Preset>;
};

export const ensureOptions = <PresetName extends string>(
  options: VideoPluginOptions<PresetName>,
): VideoPluginOptions<PresetName> =>
  videoPluginOptionsSchema.parse(options) as VideoPluginOptions<PresetName>;
