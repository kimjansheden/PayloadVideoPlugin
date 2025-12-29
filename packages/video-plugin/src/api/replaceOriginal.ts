import path from "node:path";
import fs from "node:fs/promises";

import { z } from "zod";
import type { PayloadRequest } from "payload";

import type { AccessControl, VariantRecord } from "../types";
import { gatherAllowedRoots, resolveAbsolutePath } from "../utils/filesystem";
import { getCollectionConfigFromRequest } from "../utils/payload";
import { readRequestBody, type RequestWithBody } from "./shared";

const bodySchema = z.object({
  collection: z.string().min(1, "collection is required"),
  id: z.string().min(1, "id is required"),
  preset: z.string().min(1).optional(),
});

type ReplaceRequest = RequestWithBody & PayloadRequest;

export const createReplaceOriginalHandler =
  ({ access }: { access?: AccessControl }) =>
  async (req: ReplaceRequest): Promise<Response> => {
    try {
      const rawBody = await readRequestBody(req);
      const parsed = bodySchema.parse(rawBody);

      if (access?.replaceOriginal) {
        const allowed = await access.replaceOriginal({
          req,
          collection: parsed.collection,
          id: parsed.id,
          preset: parsed.preset,
        });
        if (!allowed) {
          return Response.json(
            { error: "Not allowed to replace original video." },
            { status: 403 },
          );
        }
      }

      const payloadClient = req.payload;
      const doc = await payloadClient
        .findByID({
          collection: parsed.collection,
          id: parsed.id,
        })
        .catch((error: unknown) => {
          console.error(
            "[video-processor] Failed to load document for replace-original",
            error,
          );
          return null;
        });

      if (!doc) {
        return Response.json({ error: "Document not found." }, { status: 404 });
      }

      const variants: VariantRecord[] = Array.isArray(doc.variants)
        ? [...doc.variants]
        : [];

      if (variants.length === 0) {
        return Response.json(
          { error: "No variants are available for replacement." },
          { status: 400 },
        );
      }

      const targetVariant = parsed.preset
        ? variants.find((variant) => variant?.preset === parsed.preset)
        : variants[0];

      if (!targetVariant) {
        return Response.json(
          { error: "Requested variant was not found." },
          { status: 404 },
        );
      }

      const collectionConfig = getCollectionConfigFromRequest(
        req,
        parsed.collection,
      );
      const allowedRoots = gatherAllowedRoots({
        collection: collectionConfig,
        doc,
      });

      const variantPath =
        typeof targetVariant.path === "string" ? targetVariant.path.trim() : "";
      if (!variantPath) {
        return Response.json(
          { error: "Variant does not expose a file path." },
          { status: 400 },
        );
      }

      const resolvedVariantPath = resolveAbsolutePath(
        variantPath,
        allowedRoots,
      );
      if (!resolvedVariantPath) {
        return Response.json(
          { error: "Variant path is outside allowed directories." },
          { status: 400 },
        );
      }

      const originalPath =
        typeof doc.path === "string" && doc.path.trim().length > 0
          ? doc.path.trim()
          : typeof doc.filename === "string" && doc.filename.trim().length > 0
            ? doc.filename.trim()
            : "";

      const resolvedOriginalPath = originalPath
        ? resolveAbsolutePath(originalPath, allowedRoots)
        : null;

      if (!resolvedOriginalPath) {
        return Response.json(
          { error: "Original file path could not be resolved." },
          { status: 400 },
        );
      }

      await fs.rm(resolvedOriginalPath).catch(() => undefined);
      await fs.mkdir(path.dirname(resolvedOriginalPath), { recursive: true });
      await fs.rename(resolvedVariantPath, resolvedOriginalPath);

      const updateData: Record<string, unknown> = {
        variants: variants.filter(
          (variant) => variant?.preset !== targetVariant.preset,
        ),
      };

      if (typeof targetVariant.size === "number") {
        updateData.filesize = targetVariant.size;
      }
      if (typeof targetVariant.duration === "number") {
        updateData.duration = targetVariant.duration;
      }
      if (typeof targetVariant.width === "number") {
        updateData.width = targetVariant.width;
      }
      if (typeof targetVariant.height === "number") {
        updateData.height = targetVariant.height;
      }
      if (typeof targetVariant.bitrate === "number") {
        updateData.bitrate = targetVariant.bitrate;
      }

      const updated = await payloadClient.update({
        collection: parsed.collection,
        id: doc.id ?? parsed.id,
        data: updateData,
      });

      return Response.json({ success: true, doc: updated });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return Response.json(
          { error: error.message, issues: error.issues },
          { status: 400 },
        );
      }

      console.error("[video-processor] Failed to replace original", error);
      return Response.json(
        { error: "Unable to replace original video file." },
        { status: 500 },
      );
    }
  };
