import fs from "node:fs/promises";

import { z } from "zod";
import type { PayloadRequest } from "payload";

import type { AccessControl, VariantRecord } from "../types";
import { gatherAllowedRoots, resolveAbsolutePath } from "../utils/filesystem";
import { getCollectionConfigFromRequest } from "../utils/payload";
import { readRequestBody, type RequestWithBody } from "./shared";

const bodySchema = z
  .object({
    collection: z.string().min(1, "collection is required"),
    id: z.string().min(1, "id is required"),
    preset: z.string().min(1).optional(),
    variantId: z.string().min(1).optional(),
    variantIndex: z
      .union([z.number().int().nonnegative(), z.string().regex(/^\d+$/)])
      .optional(),
  })
  .superRefine((value, ctx) => {
    if (
      typeof value.variantIndex === "undefined" &&
      !value.variantId &&
      !value.preset
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "preset, variantId or variantIndex must be provided to remove a variant.",
        path: ["variantIndex"],
      });
    }
  });

type RemoveRequest = RequestWithBody & PayloadRequest;

export const createRemoveVariantHandler =
  ({ access }: { access?: AccessControl }) =>
  async (req: RemoveRequest): Promise<Response> => {
    try {
      const rawBody = await readRequestBody(req);
      const parsed = bodySchema.parse(rawBody);
      const variantIndex =
        typeof parsed.variantIndex === "number"
          ? parsed.variantIndex
          : typeof parsed.variantIndex === "string"
            ? Number(parsed.variantIndex)
            : undefined;

      if (Number.isNaN(variantIndex)) {
        return Response.json(
          { error: "variantIndex must be a non-negative integer." },
          { status: 400 },
        );
      }

      if (access?.removeVariant) {
        const allowed = await access.removeVariant({
          req,
          collection: parsed.collection,
          id: parsed.id,
          preset: parsed.preset,
          variantId: parsed.variantId,
          variantIndex,
        });
        if (!allowed) {
          return Response.json(
            { error: "Not allowed to remove video variants." },
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
          console.error("[video-processor] Failed to load document", error);
          return null;
        });

      if (!doc) {
        return Response.json({ error: "Document not found." }, { status: 404 });
      }

      const variants: VariantRecord[] = Array.isArray(doc.variants)
        ? doc.variants
        : [];

      let targetIndex =
        typeof variantIndex === "number" ? variantIndex : Number.NaN;

      if (Number.isNaN(targetIndex) && parsed.variantId) {
        targetIndex = variants.findIndex(
          (variant: VariantRecord | null | undefined) =>
            Boolean(
              variant &&
              typeof variant === "object" &&
              (variant as any).id === parsed.variantId,
            ),
        );
      }

      if (Number.isNaN(targetIndex) && parsed.preset) {
        targetIndex = variants.findIndex(
          (variant: VariantRecord | null | undefined) =>
            Boolean(
              variant &&
              typeof variant === "object" &&
              variant.preset === parsed.preset,
            ),
        );
      }

      if (!Number.isInteger(targetIndex) || targetIndex < 0) {
        return Response.json({ error: "Variant not found." }, { status: 404 });
      }

      const targetVariant = variants[targetIndex];
      if (!targetVariant || typeof targetVariant !== "object") {
        return Response.json({ error: "Variant not found." }, { status: 404 });
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
        typeof (targetVariant as any).path === "string"
          ? (targetVariant as any).path.trim()
          : "";
      let resolvedVariantPath: string | null = null;
      if (variantPath) {
        resolvedVariantPath = resolveAbsolutePath(variantPath, allowedRoots);
        if (!resolvedVariantPath) {
          return Response.json(
            { error: "Variant path is outside allowed directories." },
            { status: 400 },
          );
        }
      }

      const nextVariants = variants.filter(
        (_variant, index) => index !== targetIndex,
      );

      if (resolvedVariantPath) {
        await fs.rm(resolvedVariantPath).catch(() => {
          console.warn(
            `[video-processor] Could not remove variant file at ${resolvedVariantPath}`,
          );
        });
      } else {
        const fallbackUrl =
          typeof (targetVariant as any).url === "string"
            ? (targetVariant as any).url
            : "";
        const fallbackFilename = fallbackUrl.split("/").pop();
        if (fallbackFilename) {
          const fallbackPath = resolveAbsolutePath(
            fallbackFilename,
            allowedRoots,
          );
          if (fallbackPath) {
            await fs.rm(fallbackPath).catch(() => {
              console.warn(
                `[video-processor] Could not remove fallback variant file at ${fallbackPath}`,
              );
            });
          }
        }
      }

      const updated = await payloadClient.update({
        collection: parsed.collection,
        id: doc.id ?? parsed.id,
        data: { variants: nextVariants },
      });

      return Response.json({ success: true, doc: updated });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return Response.json(
          { error: error.message, issues: error.issues },
          { status: 400 },
        );
      }
      console.error("[video-processor] Failed to remove variant", error);
      return Response.json(
        { error: "Unable to remove video variant." },
        { status: 500 },
      );
    }
  };
