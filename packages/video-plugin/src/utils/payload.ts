import path from "node:path";
import { pathToFileURL } from "node:url";
import payload, { type Payload, type PayloadRequest } from "payload";
import type { CollectionConfig, SanitizedCollectionConfig } from "payload";

export type PayloadClient = {
  findByID: (args: { collection: string; id: string }) => Promise<any>;
  update: (args: {
    collection: string;
    id: string;
    data: Record<string, any>;
  }) => Promise<any>;
  getCollectionConfig?: (
    slug: string,
  ) => (CollectionConfig | SanitizedCollectionConfig) | undefined;
};

let cachedClient: PayloadClient | null = null;
let localInitialized = false;

const normalizeConfigPath = (configPath: string): string => {
  if (configPath.startsWith("file://")) return configPath;
  return pathToFileURL(path.resolve(configPath)).href;
};

const buildAuthHeaders = (token: string): Record<string, string> => ({
  Authorization: `Bearer ${token}`,
  "X-Payload-API-Key": token,
});

const initLocalPayload = async (): Promise<PayloadClient | null> => {
  const secret = process.env.PAYLOAD_SECRET;
  const mongoURL = process.env.MONGODB_URI;

  if (!secret || !mongoURL) {
    return null;
  }

  try {
    const configPath = process.env.PAYLOAD_CONFIG_PATH;
    let configModule: unknown;

    if (configPath) {
      const imported = await import(normalizeConfigPath(configPath));
      configModule = imported?.default ?? imported;
    }

    if (!localInitialized) {
      const initOptions: Record<string, unknown> = {
        secret,
        mongoURL,
        local: true,
      };

      if (configModule) {
        initOptions.config = configModule;
      }

      await payload.init(initOptions as any);
      localInitialized = true;
    }

    const instance: Payload = payload;

    return {
      findByID: ({ collection, id }) =>
        instance.findByID({
          collection,
          id,
        }),
      update: ({ collection, id, data }) =>
        instance.update({
          collection,
          id,
          data,
        }),
      getCollectionConfig: (slug: string) =>
        instance.collections?.[slug]?.config,
    } satisfies PayloadClient;
  } catch (error) {
    console.warn(
      "[video-processor] Failed to initialize Payload locally, falling back to REST client.",
      error,
    );
    return null;
  }
};

const initRestClient = async (): Promise<PayloadClient> => {
  const baseUrl =
    process.env.PAYLOAD_REST_URL ||
    process.env.PAYLOAD_PUBLIC_URL ||
    process.env.PAYLOAD_SERVER_URL;
  const token = process.env.PAYLOAD_ADMIN_TOKEN;

  if (!baseUrl || !token) {
    throw new Error(
      "Unable to establish Payload REST client. Provide PAYLOAD_REST_URL (or PAYLOAD_PUBLIC_URL) and PAYLOAD_ADMIN_TOKEN.",
    );
  }

  const base = baseUrl.replace(/\/$/, "");
  const headers = buildAuthHeaders(token);

  const request = async <T>(url: string, init?: RequestInit): Promise<T> => {
    const response = await fetch(url, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...headers,
        ...init?.headers,
      },
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        `Payload REST request failed (${response.status}): ${text}`,
      );
    }

    return (await response.json()) as T;
  };

  return {
    findByID: async ({ collection, id }) => {
      const result = await request<{ doc?: any }>(
        `${base}/api/${collection}/${id}`,
      );
      return (result as any).doc ?? result;
    },
    update: async ({ collection, id, data }) => {
      const result = await request<{ doc?: any }>(
        `${base}/api/${collection}/${id}`,
        {
          method: "PATCH",
          body: JSON.stringify(data),
        },
      );
      return (result as any).doc ?? result;
    },
  } satisfies PayloadClient;
};

export const getPayloadClient = async (): Promise<PayloadClient> => {
  if (cachedClient) return cachedClient;

  const localClient = await initLocalPayload();
  if (localClient) {
    cachedClient = localClient;
    return localClient;
  }

  const restClient = await initRestClient();
  cachedClient = restClient;
  return restClient;
};

export const getCollectionConfigFromRequest = (
  req: PayloadRequest,
  slug: string,
): CollectionConfig | null => {
  const payloadInstance = req.payload as Payload & {
    config?: Payload["config"];
  };

  const collections = (payloadInstance as any)?.collections;
  const fromCollections = collections?.[slug];
  if (fromCollections) {
    if (typeof fromCollections.config === "object") {
      return fromCollections.config as CollectionConfig;
    }
    if (typeof fromCollections === "object") {
      return fromCollections as CollectionConfig;
    }
  }

  const configured = Array.isArray(payloadInstance.config?.collections)
    ? payloadInstance.config?.collections
    : undefined;

  if (configured) {
    const match = configured.find(
      (collection) => collection && collection.slug === slug,
    );
    if (match) {
      return match as CollectionConfig;
    }
  }

  return null;
};
