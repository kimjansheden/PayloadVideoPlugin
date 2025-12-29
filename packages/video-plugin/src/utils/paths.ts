import path from "node:path";
import type { ResolvePathsArgs, ResolvePathsResult } from "../types";

const normalizeUrl = (input?: string, filename?: string): string => {
  if (!input) return filename ?? "";
  const parts = input.split("?");
  const base = parts[0];
  const query = parts[1] ? `?${parts.slice(1).join("?")}` : "";
  const lastSlash = base.lastIndexOf("/");
  if (lastSlash === -1) {
    return filename ?? base;
  }

  const prefix = base.slice(0, lastSlash);
  const sanitized = filename ?? base.slice(lastSlash + 1);
  return `${prefix}/${sanitized}${query}`;
};

export const defaultResolvePaths = ({
  original,
  presetName,
}: ResolvePathsArgs): ResolvePathsResult => {
  const originalFilename = original.filename ?? path.basename(original.path);
  const extension =
    path.extname(originalFilename) || path.extname(original.path) || ".mp4";
  const baseName = path.basename(originalFilename, extension);
  const variantFilename = `${baseName}_${presetName}${extension || ".mp4"}`;

  const originalDir = path.dirname(original.path);
  const absoluteDir = path.isAbsolute(original.path)
    ? originalDir
    : path.join(process.cwd(), originalDir);

  const url = normalizeUrl(original.url, variantFilename);

  return {
    dir: absoluteDir,
    filename: variantFilename,
    url,
  };
};

export const buildStoredPath = (
  originalPath: string,
  variantFilename: string,
): string => {
  const originalDir = path.dirname(originalPath);
  return path.join(originalDir, variantFilename);
};

export const buildWritePath = (dir: string, filename: string): string =>
  path.join(dir, filename);
