import path from "node:path";
import { fileURLToPath } from "node:url";
import type { CollectionConfig } from "payload";

const filename = fileURLToPath(import.meta.url);
const dirname = path.dirname(filename);
const rootDir = path.resolve(dirname, "..");

const staticDir = process.env.VIDEO_STORAGE_PATH
  ? path.resolve(rootDir, process.env.VIDEO_STORAGE_PATH)
  : path.resolve(rootDir, "media");

const Media: CollectionConfig = {
  slug: "media",
  upload: {
    staticDir,
    mimeTypes: ["video/mp4", "video/webm", "video/quicktime"],
  },
  admin: {
    useAsTitle: "filename",
  },
  fields: [
    {
      name: "path",
      type: "text",
      admin: {
        readOnly: true,
        position: "sidebar",
      },
    },
  ],
  hooks: {
    afterRead: [
      ({ doc }) => {
        if (doc && typeof doc.filename === "string") {
          doc.path = path.join(staticDir, doc.filename);
        }
        return doc;
      },
    ],
  },
};

export default Media;
