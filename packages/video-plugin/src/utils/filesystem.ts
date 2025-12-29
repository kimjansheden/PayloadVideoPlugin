import path from "node:path";

import type { CollectionConfig } from "../types";

const safeNormalize = (input: string): string => path.resolve(input);

const ensureTrailingSep = (input: string): string =>
  input.endsWith(path.sep) ? input : `${input}${path.sep}`;

const isWithinRoot = (candidate: string, root: string): boolean => {
  const normalizedCandidate = safeNormalize(candidate);
  const normalizedRoot = safeNormalize(root);
  return (
    normalizedCandidate === normalizedRoot ||
    normalizedCandidate.startsWith(ensureTrailingSep(normalizedRoot))
  );
};

export const gatherAllowedRoots = ({
  collection,
  doc,
}: {
  collection?: CollectionConfig | null;
  doc?: Record<string, unknown> | null;
}): string[] => {
  const roots = new Set<string>();
  roots.add(safeNormalize(process.cwd()));

  const staticDirEnv = process.env.STATIC_DIR;
  if (typeof staticDirEnv === "string" && staticDirEnv.trim()) {
    roots.add(safeNormalize(staticDirEnv));
  }

  const uploadsDirEnv = process.env.PAYLOAD_UPLOADS_DIR;
  if (typeof uploadsDirEnv === "string" && uploadsDirEnv.trim()) {
    roots.add(safeNormalize(uploadsDirEnv));
  }

  const uploadConfig =
    collection && typeof collection.upload === "object"
      ? collection.upload
      : null;
  const staticDirConfig =
    uploadConfig && typeof uploadConfig.staticDir === "string"
      ? uploadConfig.staticDir
      : null;
  if (staticDirConfig) {
    roots.add(safeNormalize(staticDirConfig));
  }

  const docPath =
    doc && typeof doc.path === "string" ? doc.path.trim() : undefined;
  if (docPath && docPath.length > 0) {
    if (path.isAbsolute(docPath)) {
      roots.add(safeNormalize(path.dirname(docPath)));
    } else {
      roots.add(safeNormalize(path.join(process.cwd(), path.dirname(docPath))));
      if (staticDirConfig) {
        roots.add(
          safeNormalize(path.join(staticDirConfig, path.dirname(docPath))),
        );
      }
    }
  }

  return Array.from(roots);
};

export const resolveAbsolutePath = (
  input: string,
  allowedRoots: string[],
): string | null => {
  if (!input) return null;
  const trimmed = input.trim();
  if (!trimmed) return null;

  const normalizedRoots = allowedRoots.map(safeNormalize);

  if (path.isAbsolute(trimmed)) {
    const normalized = safeNormalize(trimmed);
    return normalizedRoots.some((root) => isWithinRoot(normalized, root))
      ? normalized
      : null;
  }

  for (const root of normalizedRoots) {
    const candidate = safeNormalize(path.join(root, trimmed));
    if (isWithinRoot(candidate, root)) {
      return candidate;
    }
  }

  return null;
};
