import { CropRect } from "../types";
import type { CropData } from "../queue/job.types";

export type Dimensions = {
  width?: number;
  height?: number;
};

export type BuildArgsInput = {
  presetArgs: string[];
  crop?: CropRect | CropData;
  dimensions?: Dimensions;
  defaultCrf?: number;
};

export type BuildArgsResult = {
  globalOptions: string[];
  outputOptions: string[];
};

const FASTSTART_FLAGS = ["-movflags", "+faststart"];
const CRF_FLAG = "-crf";

const hasCrf = (args: string[]): boolean => {
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === CRF_FLAG) {
      return true;
    }
  }

  return false;
};

const hasFaststart = (args: string[]): boolean => {
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "-movflags") {
      const value = args[i + 1];
      if (typeof value === "string" && value.includes("faststart")) {
        return true;
      }
    }
  }

  return false;
};

const extractFilters = (
  args: string[],
): { rest: string[]; filters: string[] } => {
  const rest: string[] = [];
  const filters: string[] = [];

  for (let i = 0; i < args.length; i += 1) {
    const current = args[i];
    if (current === "-vf" || current === "-filter:v") {
      const value = args[i + 1];
      if (typeof value === "string") {
        filters.push(value);
      }
      i += 1;
    } else {
      rest.push(current);
    }
  }

  return { rest, filters };
};

const clamp = (value: number, min: number, max: number): number => {
  if (Number.isNaN(value)) return min;
  if (value < min) return min;
  if (value > max) return max;
  return value;
};

const buildCropFilter = (
  crop: CropRect | CropData,
  dimensions?: Dimensions,
): string | undefined => {
  if (!dimensions?.width || !dimensions?.height) return undefined;

  const cropWidth = Math.max(1, Math.round(dimensions.width * crop.width));
  const cropHeight = Math.max(1, Math.round(dimensions.height * crop.height));

  const maxX = Math.max(0, dimensions.width - cropWidth);
  const maxY = Math.max(0, dimensions.height - cropHeight);

  const x = clamp(Math.round(dimensions.width * crop.x), 0, maxX);
  const y = clamp(Math.round(dimensions.height * crop.y), 0, maxY);

  return `crop=${cropWidth}:${cropHeight}:${x}:${y}`;
};

/**
 * Build ffmpeg argument lists from preset args, injecting defaults such as CRF
 * and faststart flags. Crop instructions are folded into the video filter chain
 * while preserving any filters defined by the preset.
 */
export const buildFfmpegArgs = ({
  presetArgs,
  crop,
  dimensions,
  defaultCrf = 24,
}: BuildArgsInput): BuildArgsResult => {
  const args = [...presetArgs];
  const { rest, filters } = extractFilters(args);

  if (!hasCrf(rest)) {
    rest.push(CRF_FLAG, String(defaultCrf));
  }

  if (!hasFaststart(rest)) {
    rest.push(...FASTSTART_FLAGS);
  }

  if (crop) {
    const cropFilter = buildCropFilter(crop, dimensions);
    if (cropFilter) {
      filters.push(cropFilter);
    }
  }

  if (filters.length > 0) {
    rest.push("-vf", filters.join(","));
  }

  return {
    globalOptions: ["-y"],
    outputOptions: rest,
  };
};
