declare module "payload/config" {
  export function buildConfig(config: any): any;
}

declare module "payload/types" {
  export type CollectionConfig = {
    slug: string;
    fields?: any[];
    upload?:
      | boolean
      | {
          mimeTypes?: string[];
          staticDir?: string;
          [key: string]: unknown;
        };
    auth?: boolean | Record<string, unknown>;
    admin?: Record<string, unknown>;
  };
}
