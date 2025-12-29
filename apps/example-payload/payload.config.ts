import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildConfig } from "payload";
import { mongooseAdapter } from "@payloadcms/db-mongodb";
import videoPlugin from "@kimjansheden/payload-video-processor";
import Media from "./collections/Media";
import Users from "./collections/Users";
import videoPluginOptions from "./videoPluginOptions";

const filename = fileURLToPath(import.meta.url);
const dirname = path.dirname(filename);

export default buildConfig({
  secret: process.env.PAYLOAD_SECRET || "your-secret-key-here-make-it-secure",
  serverURL: process.env.PAYLOAD_PUBLIC_URL ?? "http://localhost:3000",
  admin: {
    user: Users.slug,
  },
  collections: [Users, Media],
  upload: {
    limits: {
      fileSize: 1024 * 1024 * 1024,
    },
  },
  db: mongooseAdapter({
    url:
      process.env.MONGODB_URI ??
      "mongodb://127.0.0.1:27017/payload-video-example",
  }),
  plugins: [videoPlugin(videoPluginOptions)],
  typescript: {
    outputFile: path.resolve(dirname, "payload-types.ts"),
  },
});
