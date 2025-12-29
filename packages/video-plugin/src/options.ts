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
  access: z.any().optional(),
  resolvePaths: z.any().optional(),
});

export type NormalizedPresets = Record<string, Preset>;

export const normalizePresets = (
  presets: Record<string, Preset>,
): NormalizedPresets => {
  const entries = Object.entries(presets).map(([name, preset]) => [
    name,
    { ...preset },
  ]);
  return Object.fromEntries(entries);
};

export const ensureOptions = (
  options: VideoPluginOptions,
): VideoPluginOptions =>
  videoPluginOptionsSchema.parse(options) as VideoPluginOptions;
