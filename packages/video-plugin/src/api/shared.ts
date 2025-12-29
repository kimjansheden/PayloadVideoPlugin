import type { PayloadRequest } from "payload";

export type RequestWithBody = PayloadRequest & {
  body?: unknown;
};

export const readRequestBody = async (
  req: RequestWithBody,
): Promise<unknown> => {
  // Prefer the modern web Request API when available (Payload >= 3.3 with Next runtime)
  if (typeof (req as any).json === "function") {
    try {
      return await (req as any).json();
    } catch {
      // Fallback to legacy body access if parsing fails
    }
  }

  if (typeof req.body !== "undefined") {
    return req.body;
  }

  return undefined;
};
