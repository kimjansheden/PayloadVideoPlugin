import path from "node:path";
import { fileURLToPath } from "node:url";
import type { CollectionConfig } from "payload";

const filename = fileURLToPath(import.meta.url);
const dirname = path.dirname(filename);

const Media: CollectionConfig = {
  slug: "media",
  upload: {
    staticDir: path.resolve(dirname, "../media"),
    mimeTypes: ["video/mp4", "video/webm", "video/quicktime"],
  },
  admin: {
    useAsTitle: "filename",
  },
  fields: [],
};

export default Media;
