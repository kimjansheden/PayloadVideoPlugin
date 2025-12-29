import type { PayloadRequest } from "payload";

import type { PlaybackSource, VariantRecord } from "../types";

type HeadersLike =
  | Headers
  | Record<string, string | string[] | number | boolean | undefined>;

type PlaybackInput = {
  doc: Record<string, unknown>;
  req?: PayloadRequest;
};

const isAbsoluteUrl = (value: string): boolean =>
  value.startsWith("http://") ||
  value.startsWith("https://") ||
  value.startsWith("data:") ||
  value.startsWith("blob:") ||
  value.startsWith("//");

const readHeader = (headers: HeadersLike | undefined, name: string): string => {
  if (!headers) {
    return "";
  }

  if (typeof (headers as Headers).get === "function") {
    return (
      (headers as Headers).get(name) ??
      (headers as Headers).get(name.toLowerCase()) ??
      ""
    );
  }

  const record = headers as Record<string, unknown>;
  const value = record[name] ?? record[name.toLowerCase()];
  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value)) {
    return typeof value[0] === "string" ? value[0] : "";
  }

  return "";
};

const getServerUrlFromReq = (req?: PayloadRequest): string => {
  const serverURL = req?.payload?.config?.serverURL;
  return typeof serverURL === "string" ? serverURL.trim() : "";
};

const getRequestOrigin = (req?: PayloadRequest): string => {
  const serverURL = getServerUrlFromReq(req);
  if (serverURL) {
    try {
      return new URL(serverURL).origin;
    } catch {
      // ignore and fall back to headers/url
    }
  }

  const requestUrl = typeof req?.url === "string" ? req.url : "";
  if (requestUrl && isAbsoluteUrl(requestUrl)) {
    try {
      return new URL(requestUrl).origin;
    } catch {
      // ignore and fall back to headers
    }
  }

  const headers = req?.headers as HeadersLike | undefined;
  const forwardedProto = readHeader(headers, "x-forwarded-proto");
  const forwardedHost = readHeader(headers, "x-forwarded-host");
  const host = forwardedHost || readHeader(headers, "host");
  const proto = forwardedProto || "http";

  return host ? `${proto}://${host}` : "";
};

const resolvePlaybackUrl = (input: unknown, bases: string[]): string => {
  if (typeof input !== "string") {
    return "";
  }

  const trimmed = input.trim();
  if (!trimmed) {
    return "";
  }

  if (isAbsoluteUrl(trimmed)) {
    try {
      return new URL(trimmed).toString();
    } catch {
      return "";
    }
  }

  for (const base of bases) {
    if (!base) {
      continue;
    }

    try {
      return new URL(trimmed, base).toString();
    } catch {
      // try next base
    }
  }

  return trimmed;
};

const inferVideoMimeTypeFromUrl = (url: string): string | undefined => {
  const cleanUrl = url.split("#")[0]?.split("?")[0] ?? "";
  const lower = cleanUrl.toLowerCase();

  if (
    lower.endsWith(".mp4") ||
    lower.endsWith(".m4v") ||
    lower.endsWith(".mov")
  ) {
    return "video/mp4";
  }

  if (lower.endsWith(".webm")) {
    return "video/webm";
  }

  if (lower.endsWith(".ogv") || lower.endsWith(".ogg")) {
    return "video/ogg";
  }

  return undefined;
};

const normaliseVideoSourceType = (
  mimeType: unknown,
  resolvedUrl: string,
): string | undefined => {
  const normalised =
    typeof mimeType === "string" ? mimeType.trim().toLowerCase() : "";

  // Payload often reports `.mov` as `video/quicktime`. For HTML `<source type=...>`,
  // Chrome frequently rejects that MIME even when the file is an H.264/AAC MP4-compatible
  // stream. Normalising to `video/mp4` improves playback compatibility.
  if (normalised === "video/quicktime") {
    return "video/mp4";
  }

  if (normalised) {
    return normalised;
  }

  return inferVideoMimeTypeFromUrl(resolvedUrl);
};

const getThumbnailCandidate = (doc: Record<string, unknown>): unknown => {
  const sizes = doc.sizes as Record<string, unknown> | undefined;
  if (sizes && typeof sizes === "object") {
    const sizeCandidates = ["medium", "large", "square", "thumbnail"];
    for (const key of sizeCandidates) {
      const entry = sizes[key] as Record<string, unknown> | undefined;
      const url = entry?.url;
      if (typeof url === "string" && url.trim()) {
        return url;
      }
    }
  }

  if (typeof doc.thumbnailURL === "string" && doc.thumbnailURL.trim()) {
    return doc.thumbnailURL;
  }

  return undefined;
};

export const buildPlaybackSources = ({
  doc,
  req,
}: PlaybackInput): PlaybackSource[] => {
  const sources: PlaybackSource[] = [];
  const seen = new Set<string>();

  const docUrl = typeof doc.url === "string" ? doc.url.trim() : "";
  const requestOrigin = getRequestOrigin(req);
  const bases = [docUrl, requestOrigin].filter(Boolean);

  const variants: VariantRecord[] = Array.isArray(doc.variants)
    ? (doc.variants as VariantRecord[])
    : [];

  const sortedVariants = [...variants].sort((a, b) => {
    const aSize =
      typeof a?.size === "number" ? a.size : Number.NEGATIVE_INFINITY;
    const bSize =
      typeof b?.size === "number" ? b.size : Number.NEGATIVE_INFINITY;
    return bSize - aSize;
  });

  for (const variant of sortedVariants) {
    const resolvedUrl = resolvePlaybackUrl(variant?.url, bases);
    if (!resolvedUrl || seen.has(resolvedUrl)) {
      continue;
    }

    seen.add(resolvedUrl);
    sources.push({
      preset: typeof variant?.preset === "string" ? variant.preset : undefined,
      src: resolvedUrl,
      type: normaliseVideoSourceType(undefined, resolvedUrl),
    });
  }

  const resolvedOriginalUrl = resolvePlaybackUrl(doc.url, bases);
  if (resolvedOriginalUrl && !seen.has(resolvedOriginalUrl)) {
    sources.push({
      src: resolvedOriginalUrl,
      type: normaliseVideoSourceType(doc.mimeType, resolvedOriginalUrl),
    });
  }

  return sources;
};

export const buildPlaybackPosterUrl = ({
  doc,
  req,
}: PlaybackInput): string | undefined => {
  const docUrl = typeof doc.url === "string" ? doc.url.trim() : "";
  const requestOrigin = getRequestOrigin(req);
  const bases = [docUrl, requestOrigin].filter(Boolean);
  const candidate = getThumbnailCandidate(doc);
  const resolved = resolvePlaybackUrl(candidate, bases);
  return resolved || undefined;
};
