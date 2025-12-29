import type { Queue } from "bullmq";
import type { PayloadRequest } from "payload";

export type StatusHandlerArgs = {
  getQueue: () => Queue;
};

type StatusRequest = PayloadRequest & {
  params?: {
    jobId?: string;
  };
};

const readJobId = (req: StatusRequest): string | undefined => {
  const directParam = req.params?.jobId;
  if (typeof directParam === "string" && directParam.length > 0) {
    return directParam;
  }

  const routeParam = (req.routeParams as Record<string, unknown> | undefined)
    ?.jobId;
  if (typeof routeParam === "string" && routeParam.length > 0) {
    return routeParam;
  }

  return undefined;
};

export const createStatusHandler =
  ({ getQueue }: StatusHandlerArgs) =>
  async (req: StatusRequest): Promise<Response> => {
    try {
      const jobId = readJobId(req);
      if (!jobId) {
        return Response.json(
          { error: "jobId parameter is required." },
          { status: 400 },
        );
      }

      const queue = getQueue();
      const job = await queue.getJob(jobId);
      if (!job) {
        return Response.json({ error: "Job not found." }, { status: 404 });
      }

      const state = await job.getState();
      return Response.json({ id: job.id, state, progress: job.progress });
    } catch (error) {
      console.error("[video-processor] Status handler failed", error);
      return Response.json(
        { error: "Unexpected error while reading job status." },
        { status: 500 },
      );
    }
  };
