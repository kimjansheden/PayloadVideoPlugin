import type { Queue } from "bullmq";
import { z } from "zod";
import type { PayloadRequest } from "payload";
import type { Preset, AccessControl } from "../types";
import { videoJobSchema } from "../queue/job.types";
import { readRequestBody, type RequestWithBody } from "./shared";

const bodySchema = videoJobSchema.extend({
  crop: videoJobSchema.shape.crop.optional(),
});

export type EnqueueHandlerArgs = {
  getQueue: () => Queue;
  presets: Record<string, Preset>;
  access?: AccessControl;
};

type EnqueueRequest = RequestWithBody & PayloadRequest;

export const createEnqueueHandler =
  ({ getQueue, presets, access }: EnqueueHandlerArgs) =>
  async (req: EnqueueRequest): Promise<Response> => {
    try {
      if (access?.enqueue) {
        const allowed = await access.enqueue({ req });
        if (!allowed) {
          return Response.json(
            { error: "Not allowed to enqueue video processing jobs." },
            { status: 403 },
          );
        }
      }

      const rawBody = await readRequestBody(req);
      const parsed = bodySchema.parse(rawBody);

      if (!presets[parsed.preset]) {
        return Response.json(
          { error: `Unknown preset \`${parsed.preset}\`.` },
          { status: 400 },
        );
      }

      const payloadClient = req.payload;
      const doc = await payloadClient.findByID({
        collection: parsed.collection,
        id: parsed.id,
      });

      if (!doc) {
        return Response.json({ error: "Document not found." }, { status: 404 });
      }

      const queue = getQueue();
      const job = await queue.add(parsed.preset, parsed, {
        // Keep completed jobs briefly so the status endpoint can report "completed"
        // before BullMQ removes the job entry.
        removeOnComplete: { age: 60 },
        removeOnFail: false,
      });

      return Response.json({ id: job.id, state: "queued" }, { status: 202 });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return Response.json(
          { error: error.message, issues: error.issues },
          { status: 400 },
        );
      }

      console.error("[video-processor] Enqueue handler failed", error);
      return Response.json(
        { error: "Unexpected error while enqueuing video job." },
        { status: 500 },
      );
    }
  };
