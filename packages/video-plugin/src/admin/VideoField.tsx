"use client";

import React, { type FC } from "react";
import { useDocumentInfo, useFormModified } from "@payloadcms/ui";
import type { Data } from "payload";
import type { Area, CropperProps } from "react-easy-crop";

import type {
  VariantRecord,
  VideoProcessingStatus,
  VideoVariantFieldConfig,
} from "../types";

if (typeof document !== "undefined") {
  void import("./styles.css");
}

type BridgeArgs = {
  mediaId: string;
  preset: string;
  crop?: Record<string, unknown>;
};

type BridgeResult = {
  jobId: string;
};

type RemoveVariantArgs = {
  mediaId: string;
  preset?: string;
  variantId?: string;
  variantIndex?: number;
  collection?: string;
};

type ReplaceOriginalArgs = {
  mediaId: string;
  preset?: string;
  collection?: string;
};

type BridgeConfig = {
  presets: string[];
  enqueueTranscode: (args: BridgeArgs) => Promise<BridgeResult>;
  removeVariant: (args: RemoveVariantArgs) => Promise<void>;
  replaceOriginal: (args: ReplaceOriginalArgs) => Promise<void>;
};

declare global {
  interface Window {
    __PAYLOAD_VIDEO_PLUGIN__?: BridgeConfig;
  }
}

type JobStatus = {
  id: string | number;
  state: string;
  progress?: number;
};

type FieldProps = {
  field: {
    label?: string;
    custom?: VideoVariantFieldConfig;
  };
} & Partial<VideoVariantFieldConfig>;

type VideoDocument = {
  url?: string;
  playbackPosterUrl?: string;
  variants?: VariantRecord[];
  videoProcessingStatus?: VideoProcessingStatus | null;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const extractDocument = (payload: unknown): VideoDocument | null => {
  if (!isRecord(payload)) return null;
  const candidate = isRecord(payload.doc) ? payload.doc : payload;
  if (!isRecord(candidate)) return null;
  return candidate as VideoDocument;
};

const isVideoVariantFieldConfig = (
  value: unknown,
): value is VideoVariantFieldConfig => {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.enqueuePath === "string" &&
    typeof candidate.statusPath === "string" &&
    typeof candidate.replaceOriginalPath === "string" &&
    typeof candidate.removeVariantPath === "string" &&
    typeof candidate.collectionSlug === "string" &&
    typeof candidate.queueName === "string" &&
    Boolean(candidate.presets) &&
    typeof candidate.presets === "object"
  );
};

const DEFAULT_CROP = {
  x: 0,
  y: 0,
  width: 1,
  height: 1,
};

const resolveApiBase = (enqueuePath: string): string =>
  enqueuePath.replace(/\/video-queue\/enqueue$/, "");

const formatProgress = (value?: number): string => {
  if (typeof value !== "number") return "0%";
  return `${Math.round(value)}%`;
};

const isActiveJobState = (state?: string): boolean =>
  Boolean(state && state !== "completed" && state !== "failed");

const readVariantPreset = (variant: VariantRecord | null | undefined) => {
  if (!variant || typeof variant !== "object") return undefined;
  if (typeof variant.preset === "string" && variant.preset.trim().length > 0) {
    return variant.preset.trim();
  }
  return undefined;
};

const readVariantId = (variant: VariantRecord | null | undefined) => {
  const rawId = (variant as { id?: unknown })?.id;
  if (typeof rawId === "string" && rawId.trim().length > 0) {
    return rawId.trim();
  }
  return undefined;
};

const resolveVariantIdentifier = (
  variant: VariantRecord,
  fallback: string,
): string => {
  return (
    readVariantId(variant) ??
    readVariantPreset(variant) ??
    fallback ??
    "variant"
  );
};

const formatBytes = (value?: number): string => {
  if (!value || Number.isNaN(value)) return "-";
  const units = ["B", "KB", "MB", "GB"];
  let size = value;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(1)} ${units[unitIndex]}`;
};

const formatSeconds = (value?: number): string => {
  if (!value || Number.isNaN(value)) return "-";
  if (value < 60) {
    return `${value.toFixed(1)} s`;
  }
  const minutes = Math.floor(value / 60);
  const seconds = Math.round(value % 60);
  return `${minutes} min ${seconds}s`;
};

const VideoField: FC<FieldProps> = (props) => {
  const { useEffect, useMemo, useState, useCallback, useRef } = React;
  const { field } = props;
  const { id, lastUpdateTime, setData } = useDocumentInfo();
  const formModified = useFormModified();
  const custom =
    field.custom ?? (isVideoVariantFieldConfig(props) ? props : undefined);
  const presets = custom?.presets ?? {};
  const apiBase = useMemo(
    () => (custom ? resolveApiBase(custom.enqueuePath) : "/api"),
    [custom],
  );
  const presetNames = useMemo(() => Object.keys(presets), [presets]);
  const docId = useMemo(() => {
    if (typeof id === "undefined" || id === null) return null;
    const value = String(id);
    if (!value || value === "create") return null;
    return value;
  }, [id]);

  // Lazy load react-easy-crop to avoid SSR issues
  const [EasyCrop, setEasyCrop] =
    useState<React.ComponentType<CropperProps> | null>(null);

  useEffect(() => {
    if (typeof window !== "undefined" && !EasyCrop) {
      import("react-easy-crop").then((module) => {
        setEasyCrop(() => module.default);
      });
    }
  }, [EasyCrop]);

  const [selectedPreset, setSelectedPreset] = useState<string | undefined>(
    presetNames[0],
  );
  const [docData, setDocData] = useState<VideoDocument | null>(null);
  const [loadingDoc, setLoadingDoc] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<{
    type: "success" | "error" | "info";
    text: string;
  } | null>(null);
  const [jobStatus, setJobStatus] = useState<JobStatus | null>(null);
  const [pollingJobId, setPollingJobId] = useState<string | null>(null);
  const [expectedPreset, setExpectedPreset] = useState<string | null>(null);
  const [processingStatus, setProcessingStatus] =
    useState<VideoProcessingStatus | null>(null);
  const [variants, setVariants] = useState<VariantRecord[]>([]);
  const [previewKey, setPreviewKey] = useState<string | null>(null);
  const [replaceLoading, setReplaceLoading] = useState<string | null>(null);
  const [deleteLoading, setDeleteLoading] = useState<string | null>(null);
  const [cropState, setCropState] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [cropSelection, setCropSelection] = useState(DEFAULT_CROP);
  const expectedPresetRef = useRef<string | null>(null);
  const sleep = useCallback(
    (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
    [],
  );

  useEffect(() => {
    expectedPresetRef.current = expectedPreset;
  }, [expectedPreset]);

  useEffect(() => {
    if (!processingStatus) return;
    const statusJobId =
      typeof processingStatus.jobId === "string"
        ? processingStatus.jobId.trim()
        : "";
    if (!statusJobId) return;

    if (!jobStatus) {
      setJobStatus({
        id: statusJobId,
        state: processingStatus.state,
        progress: processingStatus.progress,
      });
    }

    if (isActiveJobState(processingStatus.state) && !pollingJobId) {
      setPollingJobId(statusJobId);
      if (!expectedPreset && processingStatus.preset) {
        setExpectedPreset(processingStatus.preset);
      }
    }

    if (
      processingStatus.preset &&
      presets[processingStatus.preset] &&
      (!selectedPreset ||
        (isActiveJobState(processingStatus.state) &&
          selectedPreset !== processingStatus.preset))
    ) {
      setSelectedPreset(processingStatus.preset);
    }
  }, [
    expectedPreset,
    jobStatus,
    pollingJobId,
    presets,
    processingStatus,
    selectedPreset,
  ]);

  const messageClassName =
    message?.type === "error"
      ? "bg-rose-50 text-rose-700"
      : message?.type === "info"
        ? "bg-slate-50 text-slate-700"
        : "bg-emerald-50 text-emerald-700";

  const sendEnqueueRequest = useCallback(
    async ({
      documentId,
      presetName,
      crop,
    }: {
      documentId: string;
      presetName: string;
      crop?: Record<string, unknown>;
    }): Promise<JobStatus> => {
      if (!custom) {
        throw new Error("Video plugin is not configured.");
      }

      const response = await fetch(custom.enqueuePath, {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          collection: custom.collectionSlug,
          id: documentId,
          preset: presetName,
          crop,
        }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(
          payload?.error ?? `Request failed (${response.status})`,
        );
      }

      return (await response.json()) as JobStatus;
    },
    [custom],
  );

  const sendRemoveVariantRequest = useCallback(
    async ({
      documentId,
      preset,
      variantId,
      variantIndex,
    }: {
      documentId: string;
      preset?: string;
      variantId?: string;
      variantIndex?: number;
    }) => {
      if (!custom) {
        throw new Error("Video plugin is not configured.");
      }

      const response = await fetch(custom.removeVariantPath, {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          collection: custom.collectionSlug,
          id: documentId,
          preset,
          variantId,
          variantIndex,
        }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(
          payload?.error ?? `Request failed (${response.status})`,
        );
      }

      return (await response.json()) as { doc?: unknown };
    },
    [custom],
  );

  const sendReplaceOriginalRequest = useCallback(
    async ({ documentId, preset }: { documentId: string; preset?: string }) => {
      if (!custom) {
        throw new Error("Video plugin is not configured.");
      }

      const response = await fetch(custom.replaceOriginalPath, {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          collection: custom.collectionSlug,
          id: documentId,
          preset,
        }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(
          payload?.error ?? `Request failed (${response.status})`,
        );
      }

      return (await response.json()) as { doc?: unknown };
    },
    [custom],
  );

  const bridgeEnqueue = useCallback(
    async ({ mediaId, preset, crop }: BridgeArgs): Promise<BridgeResult> => {
      if (!mediaId) {
        throw new Error("A media id is required to enqueue transcoding.");
      }

      if (!preset) {
        throw new Error("A preset name is required to enqueue transcoding.");
      }

      const job = await sendEnqueueRequest({
        documentId: mediaId,
        presetName: preset,
        crop,
      });

      const jobId =
        typeof job.id === "string" || typeof job.id === "number"
          ? String(job.id)
          : "";

      if (!jobId) {
        throw new Error("Unable to determine job id returned by the server.");
      }

      return { jobId };
    },
    [sendEnqueueRequest],
  );

  const bridgeRemoveVariant = useCallback(
    async ({
      mediaId,
      preset,
      variantId,
      variantIndex,
    }: RemoveVariantArgs): Promise<void> => {
      if (!mediaId) {
        throw new Error("A media id is required to remove a variant.");
      }

      const payload = await sendRemoveVariantRequest({
        documentId: mediaId,
        preset,
        variantId,
        variantIndex,
      });

      if (docId === mediaId) {
        const nextDoc = extractDocument(payload);
        if (nextDoc) {
          setDocData(nextDoc);
          const docVariants = Array.isArray(nextDoc?.variants)
            ? nextDoc.variants
            : [];
          setVariants(docVariants);
        } else {
          setVariants((current) =>
            current.filter((variant, index) => {
              if (typeof variantIndex === "number" && variantIndex === index) {
                return false;
              }
              if (variantId && readVariantId(variant) === variantId) {
                return false;
              }
              if (preset && readVariantPreset(variant) === preset) {
                return false;
              }
              return true;
            }),
          );
        }
      }

      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("payload-video-plugin:change"));
      }
    },
    [docId, sendRemoveVariantRequest],
  );

  const bridgeReplaceOriginal = useCallback(
    async ({ mediaId, preset }: ReplaceOriginalArgs) => {
      if (!mediaId) {
        throw new Error("A media id is required to replace the original.");
      }

      const payload = await sendReplaceOriginalRequest({
        documentId: mediaId,
        preset,
      });

      if (docId === mediaId) {
        const nextDoc = extractDocument(payload);
        if (nextDoc) {
          setDocData(nextDoc);
          const docVariants = Array.isArray(nextDoc?.variants)
            ? nextDoc.variants
            : [];
          setVariants(docVariants);
        }
      }

      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("payload-video-plugin:change"));
      }
    },
    [docId, sendReplaceOriginalRequest],
  );
  useEffect(() => {
    if (typeof window === "undefined" || !custom) {
      return;
    }

    const bridge: BridgeConfig = {
      presets: presetNames,
      enqueueTranscode: async (args) => {
        const cropArg = args.crop;
        const presetConfig = presets[args.preset];
        const allowCrop = Boolean(presetConfig?.enableCrop);
        return bridgeEnqueue({
          mediaId: args.mediaId,
          preset: args.preset,
          crop: allowCrop ? cropArg : undefined,
        });
      },
      removeVariant: async (args) =>
        bridgeRemoveVariant({
          mediaId: args.mediaId,
          preset: args.preset,
          variantId: args.variantId,
          variantIndex: args.variantIndex,
        }),
      replaceOriginal: async (args) =>
        bridgeReplaceOriginal({
          mediaId: args.mediaId,
          preset: args.preset,
        }),
    };

    window.__PAYLOAD_VIDEO_PLUGIN__ = bridge;
    window.dispatchEvent(new CustomEvent("payload-video-plugin:change"));

    return () => {
      if (
        window.__PAYLOAD_VIDEO_PLUGIN__?.enqueueTranscode ===
        bridge.enqueueTranscode
      ) {
        delete window.__PAYLOAD_VIDEO_PLUGIN__;
        window.dispatchEvent(new CustomEvent("payload-video-plugin:change"));
      }
    };
  }, [
    bridgeEnqueue,
    bridgeRemoveVariant,
    bridgeReplaceOriginal,
    custom,
    presetNames,
    presets,
  ]);

  useEffect(() => {
    if (presetNames.length > 0 && !selectedPreset) {
      setSelectedPreset(presetNames[0]);
    }
  }, [presetNames, selectedPreset]);

  const fetchDocument = useCallback(async () => {
    if (!docId || !custom) {
      setDocData(null);
      setVariants([]);
      return null;
    }

    try {
      setLoadingDoc(true);
      setError(null);

      const response = await fetch(
        `${apiBase}/${custom.collectionSlug}/${docId}?t=${Date.now()}`,
        {
          credentials: "include",
          cache: "no-store",
        },
      );
      if (!response.ok) {
        throw new Error(`Failed to load document (${response.status})`);
      }

      const payload = await response.json();
      const nextDoc = extractDocument(payload);

      if (!nextDoc) {
        setDocData(null);
        setVariants([]);
        setProcessingStatus(null);
        return null;
      }

      setDocData(nextDoc);
      if (!formModified) {
        setData(nextDoc as Data);
      }
      setProcessingStatus(nextDoc.videoProcessingStatus ?? null);

      const docVariants = Array.isArray(nextDoc.variants)
        ? nextDoc.variants
        : [];
      setVariants(docVariants);

      return { doc: nextDoc, variants: docVariants };
    } catch (fetchError) {
      setError(
        fetchError instanceof Error
          ? fetchError.message
          : "Failed to load document data.",
      );
      return null;
    } finally {
      setLoadingDoc(false);
    }
  }, [apiBase, custom, docId, formModified, setData]);

  useEffect(() => {
    void fetchDocument();
  }, [fetchDocument, jobStatus?.state, lastUpdateTime]);

  const enqueue = useCallback(async () => {
    if (!custom || !docId || !selectedPreset) return;
    try {
      setError(null);
      setMessage(null);
      setExpectedPreset(selectedPreset);
      const allowCrop = Boolean(presets[selectedPreset]?.enableCrop);
      const data = await sendEnqueueRequest({
        documentId: docId,
        presetName: selectedPreset,
        crop: allowCrop ? cropSelection : undefined,
      });
      setJobStatus(data);
      setPollingJobId(String(data.id));
    } catch (enqueueError) {
      setError(
        enqueueError instanceof Error
          ? enqueueError.message
          : "Failed to enqueue job.",
      );
    }
  }, [
    custom,
    cropSelection,
    docId,
    presets,
    selectedPreset,
    sendEnqueueRequest,
  ]);

  useEffect(() => {
    if (!pollingJobId || !custom) return;
    let active = true;

    const refreshAfterCompletion = async (jobId: string) => {
      const presetToWaitFor = expectedPresetRef.current;
      if (!presetToWaitFor) {
        await fetchDocument();
        return;
      }

      const result = await fetchDocument();
      const hasVariant = Boolean(
        presetToWaitFor &&
        result?.variants?.some(
          (variant) => readVariantPreset(variant) === presetToWaitFor,
        ),
      );

      setExpectedPreset(null);
      setJobStatus({ id: jobId, state: "completed", progress: 100 });

      if (hasVariant && presetToWaitFor) {
        setMessage({
          type: "success",
          text: `Variant \"${presetToWaitFor}\" saved.`,
        });
        return;
      }

      if (active) {
        const refreshNote = formModified
          ? "Save or reload to see the updated file metadata."
          : "Original metadata has been refreshed.";
        setMessage({
          type: "info",
          text: `Job ${jobId} completed. ${refreshNote}`,
        });
      }
    };

    const interval = window.setInterval(async () => {
      try {
        const response = await fetch(
          `${custom.statusPath}/${pollingJobId}?t=${Date.now()}`,
          {
            credentials: "include",
            cache: "no-store",
          },
        );
        if (!response.ok) {
          if (response.status === 404) {
            if (active) {
              setJobStatus({ id: pollingJobId, state: "unknown" });
              setPollingJobId(null);
              setMessage({
                type: "info",
                text: `Job ${pollingJobId} status is no longer available. Refreshing variants…`,
              });
              void refreshAfterCompletion(pollingJobId);
            }
            return;
          }
          throw new Error(`Status request failed (${response.status})`);
        }
        const payload = (await response.json()) as JobStatus;
        if (active) {
          setJobStatus(payload);
          if (payload.state === "completed" || payload.state === "failed") {
            setPollingJobId(null);
            void refreshAfterCompletion(String(payload.id));
          }
        }
      } catch (statusError) {
        if (active) {
          setPollingJobId(null);
          setError(
            statusError instanceof Error
              ? statusError.message
              : "Status polling failed.",
          );
        }
      }
    }, 1500);

    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [custom, fetchDocument, formModified, pollingJobId, sleep]);

  const preset = selectedPreset ? presets[selectedPreset] : undefined;
  const cropEnabled = Boolean(preset?.enableCrop);
  const activePresetLabel = expectedPreset
    ? (presets[expectedPreset]?.label ?? expectedPreset)
    : null;
  const posterUrl =
    typeof docData?.playbackPosterUrl === "string"
      ? docData.playbackPosterUrl.trim()
      : "";

  useEffect(() => {
    if (!cropEnabled) {
      setCropSelection(DEFAULT_CROP);
      setCropState({ x: 0, y: 0 });
      setZoom(1);
    }
  }, [cropEnabled]);

  const handleCropComplete = useCallback((area: Area) => {
    setCropSelection({
      width: area.width / 100,
      height: area.height / 100,
      x: area.x / 100,
      y: area.y / 100,
    });
  }, []);

  const handleTogglePreview = useCallback((key: string) => {
    setPreviewKey((current) => (current === key ? null : key));
  }, []);

  const handleReplaceOriginalVariant = useCallback(
    async (variant: VariantRecord) => {
      if (!docId) {
        setError("Document id is missing; save before replacing the original.");
        return;
      }

      const preset = readVariantPreset(variant);
      const identifier = resolveVariantIdentifier(variant, preset ?? "variant");

      if (typeof window !== "undefined") {
        const confirmation = window.confirm(
          `Replace the original file with variant "${identifier}"?`,
        );
        if (!confirmation) {
          return;
        }
      }

      setError(null);
      setMessage(null);
      setReplaceLoading(identifier);

      try {
        const payload = await sendReplaceOriginalRequest({
          documentId: docId,
          preset,
        });
        const updatedDoc = extractDocument(payload);
        if (updatedDoc) {
          setDocData(updatedDoc);
          const docVariants = Array.isArray(updatedDoc?.variants)
            ? updatedDoc.variants
            : [];
          setVariants(docVariants);
        } else {
          setVariants((current) =>
            current.filter(
              (candidate) =>
                readVariantPreset(candidate) !== readVariantPreset(variant),
            ),
          );
        }
        setPreviewKey((current) => (current === identifier ? null : current));
        setMessage({ type: "success", text: "Original video replaced." });
        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent("payload-video-plugin:change"));
        }
      } catch (replaceError) {
        setError(
          replaceError instanceof Error
            ? replaceError.message
            : "Failed to replace the original video.",
        );
      } finally {
        setReplaceLoading(null);
      }
    },
    [docId, sendReplaceOriginalRequest],
  );

  const handleRemoveVariant = useCallback(
    async (variant: VariantRecord, index: number) => {
      if (!docId) {
        setError("Document id is missing; save before removing variants.");
        return;
      }

      const fallbackIdentifier = `variant-${index + 1}`;
      const identifier = resolveVariantIdentifier(variant, fallbackIdentifier);

      if (typeof window !== "undefined") {
        const confirmation = window.confirm(
          `Remove variant "${identifier}"? This cannot be undone.`,
        );
        if (!confirmation) {
          return;
        }
      }

      setError(null);
      setMessage(null);
      setDeleteLoading(identifier);

      try {
        const payload = await sendRemoveVariantRequest({
          documentId: docId,
          preset: readVariantPreset(variant),
          variantId: readVariantId(variant),
          variantIndex: index,
        });
        const updatedDoc = extractDocument(payload);
        if (updatedDoc) {
          setDocData(updatedDoc);
          const docVariants = Array.isArray(updatedDoc?.variants)
            ? updatedDoc.variants
            : [];
          setVariants(docVariants);
        } else {
          setVariants((current) =>
            current.filter(
              (_candidate, candidateIndex) => candidateIndex !== index,
            ),
          );
        }
        setPreviewKey((current) => (current === identifier ? null : current));
        setMessage({ type: "success", text: "Variant removed." });
        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent("payload-video-plugin:change"));
        }
      } catch (removeError) {
        setError(
          removeError instanceof Error
            ? removeError.message
            : "Failed to remove variant.",
        );
      } finally {
        setDeleteLoading(null);
      }
    },
    [docId, sendRemoveVariantRequest],
  );

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-white/60 p-4 shadow-sm">
      <div className="flex flex-col gap-2">
        <span className="text-sm font-semibold text-slate-700">
          {field.label ?? "Video processor"}
        </span>
        {jobStatus && isActiveJobState(jobStatus.state) ? (
          <div
            className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-800"
            role="status"
          >
            Processing video, please wait...{" "}
            {activePresetLabel ? `(${activePresetLabel}) ` : ""}
            {formatProgress(jobStatus.progress)}
          </div>
        ) : null}
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex flex-col text-xs font-medium text-slate-600">
            Preset
            <select
              className="mt-1 w-48 rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm focus:border-slate-500 focus:outline-none"
              value={selectedPreset ?? ""}
              onChange={(event) => setSelectedPreset(event.target.value)}
            >
              {presetNames.map((name) => (
                <option key={name} value={name}>
                  {presets[name]?.label ?? name}
                </option>
              ))}
            </select>
          </label>
          <button
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:bg-slate-400"
            type="button"
            disabled={!docId || !selectedPreset}
            onClick={enqueue}
          >
            Enqueue variant
          </button>
          {jobStatus ? (
            <span className="text-xs text-slate-600">
              Job {jobStatus.id}: {jobStatus.state} ·{" "}
              {formatProgress(jobStatus.progress)}
            </span>
          ) : null}
          {custom?.queueName ? (
            <span className="text-xs text-slate-400">
              Queue: {custom.queueName}
            </span>
          ) : null}
        </div>
        {!docId ? (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
            Save the document before enqueuing video variants.
          </p>
        ) : null}
        {error ? (
          <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">
            {error}
          </p>
        ) : null}
        {message ? (
          <p className={`rounded-lg px-3 py-2 text-xs ${messageClassName}`}>
            {message.text}
          </p>
        ) : null}
      </div>

      {cropEnabled && docData?.url ? (
        <div className="flex flex-col gap-3">
          <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Crop
          </span>
          <div className="video-crop-wrapper">
            {EasyCrop ? (
              <EasyCrop
                video={docData.url}
                crop={cropState}
                zoom={zoom}
                rotation={0}
                aspect={4 / 3}
                minZoom={1}
                maxZoom={3}
                cropShape="rect"
                zoomSpeed={1}
                restrictPosition
                mediaProps={{}}
                cropperProps={{}}
                style={{}}
                classes={{}}
                keyboardStep={1}
                onCropChange={setCropState}
                onZoomChange={setZoom}
                onCropComplete={handleCropComplete}
                objectFit="contain"
                showGrid
              />
            ) : (
              <div>Loading cropper...</div>
            )}
          </div>
          <label className="flex items-center gap-2 text-xs text-slate-600">
            Zoom
            <input
              type="range"
              min={1}
              max={3}
              step={0.1}
              value={zoom}
              onChange={(event) => setZoom(Number(event.target.value))}
              className="w-48"
            />
          </label>
        </div>
      ) : null}

      {posterUrl ? (
        <div className="flex flex-col gap-2 text-xs text-slate-600">
          <span className="font-semibold uppercase tracking-wide text-slate-500">
            Poster
          </span>
          <div className="overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
            <img
              src={posterUrl}
              alt="Video poster"
              className="h-auto w-full object-contain"
              loading="lazy"
            />
          </div>
        </div>
      ) : null}

      <div className="flex flex-col gap-2 text-xs text-slate-600">
        <span className="font-semibold uppercase tracking-wide text-slate-500">
          Variants
        </span>
        {loadingDoc ? (
          <span className="text-xs text-slate-500">
            Loading document metadata…
          </span>
        ) : null}
        {variants.length === 0 ? (
          <p className="rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-600">
            No variants available yet. Enqueue a preset to generate a new
            version of the video.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {variants.map((variant, index) => {
              const presetName =
                readVariantPreset(variant) ?? `Variant ${index + 1}`;
              const identifier = resolveVariantIdentifier(
                variant,
                `variant-${index + 1}`,
              );
              const url =
                typeof variant.url === "string" ? variant.url : undefined;
              const previewing = previewKey === identifier;
              const replacing = replaceLoading === identifier;
              const deleting = deleteLoading === identifier;

              return (
                <div
                  key={`${identifier}-${index}`}
                  className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-col">
                      <span className="text-sm font-semibold text-slate-700">
                        {presetName}
                      </span>
                      <span className="text-xs text-slate-500">
                        {formatBytes(variant.size)} ·{" "}
                        {formatSeconds(variant.duration)}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      {url ? (
                        <button
                          className="rounded-lg border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 transition hover:border-slate-400 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
                          type="button"
                          onClick={() => handleTogglePreview(identifier)}
                          disabled={replacing || deleting}
                        >
                          {previewing ? "Close preview" : "Preview"}
                        </button>
                      ) : null}
                      <button
                        className="rounded-lg bg-slate-900 px-3 py-1 text-xs font-semibold disabled:cursor-not-allowed disabled:bg-slate-400"
                        type="button"
                        onClick={() =>
                          void handleReplaceOriginalVariant(variant)
                        }
                        disabled={replacing || deleting}
                      >
                        {replacing ? "Replacing…" : "Replace original"}
                      </button>
                      <button
                        className="rounded-lg border border-rose-300 px-3 py-1 text-xs font-semibold text-rose-700 transition hover:border-rose-400 hover:text-rose-900 disabled:cursor-not-allowed disabled:opacity-60"
                        type="button"
                        onClick={() => void handleRemoveVariant(variant, index)}
                        disabled={deleting || replacing}
                      >
                        {deleting ? "Deleting…" : "Delete"}
                      </button>
                    </div>
                  </div>
                  {previewing && url ? (
                    <div className="overflow-hidden rounded-lg border border-slate-200">
                      <video
                        className="w-full bg-black"
                        controls
                        preload="metadata"
                        poster={posterUrl || undefined}
                        src={url}
                      />
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default VideoField;
