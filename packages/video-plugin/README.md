# @kimjansheden/payload-video-processor

[![npm](https://img.shields.io/npm/v/@kimjansheden/payload-video-processor)](https://www.npmjs.com/package/@kimjansheden/payload-video-processor)

Queued FFmpeg-based video variant generation for Payload CMS. The plugin mirrors
Payload's image size workflow for videos by adding a `variants[]` array to video
collections and exposing an Admin UI that lets editors enqueue transcoding jobs.
Designed to be plug-and-play: no custom endpoints, no extra UI code in the
consumer project.

## Demo videos

- Upload + auto-compression: <https://kimjansheden.se/videos/payload-video-processor/video-plugin-1.mp4>
- Cropping: <https://kimjansheden.se/videos/payload-video-processor/video-plugin-2-cropping.mp4>

## Features

- ⚙️ Queue backed by BullMQ + Redis so processing runs outside the web process.
- 🎞️ Configurable presets that append FFmpeg arguments per output variant.
- ✂️ Optional crop UI powered by `react-easy-crop` for frame-accurate crops.
- 🧰 Admin field handles enqueueing, previewing, replacing, and deleting variants without extra glue code.
- 📁 Outputs written next to the original upload (or via custom path resolver).
- 🔄 Worker CLI can bootstrap Payload locally or fall back to REST APIs.

## Installation

```bash
pnpm add @kimjansheden/payload-video-processor
```

Peer dependencies (`payload`, `react`, `react-dom`) must already exist in your
Payload project. The package bundles static FFmpeg/ffprobe binaries via
`ffmpeg-static`; if those are blocked on your platform, set `FFMPEG_BIN` to a
system ffmpeg binary (for example `/opt/homebrew/bin/ffmpeg` on macOS/Homebrew).

## Quick start

### Step 1: Register the plugin

Define presets and register the plugin in your `payload.config.ts` (or wherever you build your Payload config):

```ts
import { buildConfig } from "payload";
import { mongooseAdapter } from "@payloadcms/db-mongodb";
import videoPlugin from "@kimjansheden/payload-video-processor";

const videoOptions = {
  presets: {
    mobile360: {
      label: "360p Mobile",
      args: ["-vf", "scale=-2:360", "-crf", "32"],
    },
    hd720: {
      label: "720p HD",
      args: ["-vf", "scale=-2:720", "-crf", "24"],
      enableCrop: true,
    },
  },
  queue: {
    redisUrl: process.env.REDIS_URL,
    concurrency: 1,
  },
  // Auto-enqueue a preset when a new video is uploaded.
  autoEnqueue: true,
  // Optional: override the default preset used on create.
  autoEnqueuePreset: "hd720",
  // Optional: replace the original with the auto-generated variant.
  autoReplaceOriginal: true,
};

export default buildConfig({
  // This plugin works with both DATABASE_URI and MONGODB_URI; the worker CLI maps DATABASE_URI -> MONGODB_URI.
  db: mongooseAdapter({
    url: process.env.DATABASE_URI ?? process.env.MONGODB_URI ?? "",
  }),
  collections: [
    /* … */
  ],
  plugins: [videoPlugin(videoOptions)],
});
```

Recommended host pattern: export the options object from `src/videoPluginOptions.ts` and import it in both your Payload config and `worker/payload.worker.config.ts`, so presets/queue settings stay in one place.

When `autoEnqueue` is `true`, the plugin
tries a preset named `1080`, then `hd1080`, and finally falls back to the first
configured preset.
Set `autoEnqueuePreset` to force a specific preset name when auto-enqueueing.

### Cropping behavior

Cropping is optional and configured per preset via `enableCrop: true`.

- `enableCrop` only exposes crop controls in the Admin UI.
- Cropping is **opt-in per enqueue**: the generated variant is not cropped unless
  the editor explicitly enables “Apply crop for this enqueue”.
- If cropping is not enabled, no crop parameters are sent to the worker and the
  full frame is preserved.

### Type-safe presets (TypeScript)

```ts
import videoPlugin, {
  type VideoPluginOptions,
} from "@kimjansheden/payload-video-processor";

const presets = {
  mobile360: { label: "360p Mobile", args: ["-vf", "scale=-2:360"] },
  hd1080: { label: "Full HD 1080p", args: ["-vf", "scale=-2:1080"] },
} satisfies VideoPluginOptions["presets"];

type PresetName = keyof typeof presets;

const options: VideoPluginOptions<PresetName> = {
  presets,
  queue: { redisUrl: process.env.REDIS_URL, concurrency: 1 },
  autoEnqueue: true,
  autoEnqueuePreset: "hd1080",
  autoReplaceOriginal: true,
};
```

### Import patterns

ESM:

```ts
import videoPlugin from "@kimjansheden/payload-video-processor";
```

CommonJS:

```ts
const videoPlugin = require("@kimjansheden/payload-video-processor").default;
```

For the worker options module, either export default (ESM) or use
`module.exports = options` (CommonJS), then point the CLI at the built file.

### Options reference

| Option                | Type                           | Notes                                                    |
| --------------------- | ------------------------------ | -------------------------------------------------------- |
| `presets`             | `Record<string, Preset>`       | Required. Keys become preset names.                      |
| `queue`               | `QueueConfig`                  | Optional queue name/redis URL/concurrency.               |
| `autoEnqueue`         | `boolean`                      | `true` uses `autoEnqueuePreset` or the default fallback. |
| `autoEnqueuePreset`   | `string`                       | Must match a preset key, not the label.                  |
| `autoReplaceOriginal` | `boolean`                      | Only applies to auto-enqueued jobs.                      |
| `access`              | `AccessControl`                | Optional access control hooks.                           |
| `resolvePaths`        | `(args) => ResolvePathsResult` | Override output directory/filename/URL.                  |

### Step 2: Ensure the upload collection exposes `path` (local filesystem)

The worker needs to read the original upload from disk. For local filesystem
storage, the worker reads the original file path from `doc.path` (absolute path
on disk). If your upload collection does not already provide a `path`, add a
read-only field and populate it from your upload `staticDir` + `filename`:

```ts
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { CollectionConfig } from "payload";

const filename = fileURLToPath(import.meta.url);
const dirname = path.dirname(filename);

const staticDir =
  process.env.STATIC_DIR ?? path.resolve(dirname, "../../public/media");

export const Media: CollectionConfig = {
  slug: "media",
  upload: {
    staticDir,
    mimeTypes: ["video/mp4", "video/webm", "video/quicktime"],
  },
  fields: [
    {
      name: "path",
      type: "text",
      admin: { readOnly: true, position: "sidebar" },
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
```

### Step 3: Bundle the plugin options for the worker CLI

Provide a worker options module and bundle it to JS (the CLI needs a JS file). Example:

```ts
// src/videoPluginOptions.ts
export default videoOptions;
```

```bash
tsup src/videoPluginOptions.ts --format esm --platform node --target es2022 --out-dir dist-config --minify
```

### Step 4: Add a minimal Payload config for the worker (recommended)

When you pass `--payload-config`, the worker can initialize Payload locally and update documents via the local Node API.

```ts
// worker/payload.worker.config.ts
import { mongooseAdapter } from "@payloadcms/db-mongodb";
import { buildConfig } from "payload";
import videoPlugin from "@kimjansheden/payload-video-processor";

import { Media } from "../src/collections/Media";
import videoPluginOptions from "../src/videoPluginOptions";

export default buildConfig({
  telemetry: false,
  secret: process.env.PAYLOAD_SECRET || "dev-secret",
  db: mongooseAdapter({
    url: process.env.MONGODB_URI || process.env.DATABASE_URI || "",
  }),
  plugins: [videoPlugin(videoPluginOptions)],
  collections: [Media],
});
```

Bundle it:

```bash
tsup worker/payload.worker.config.ts --format esm --platform node --target es2022 --out-dir dist-config --minify
```

### Step 5: Start the worker

Start the worker in a separate process:

```bash
payload-video-worker \
  --config ./dist-config/videoPluginOptions.js \
  --payload-config ./dist-config/payload.worker.config.js
```

To initialize Payload locally, ensure `PAYLOAD_SECRET` + `DATABASE_URI` (or `MONGODB_URI`) are set. If you
prefer the REST fallback, omit `--payload-config` and provide
`PAYLOAD_REST_URL` + `PAYLOAD_ADMIN_TOKEN`.

The CLI loads `.env`, `.env.local`, `.env.development`, and `.env.production`
automatically (unless you pass `--no-default-env`). Additional `--env` flags can
point to project-specific files.

Example (explicit env + static dir, useful in monorepos):

```bash
FFMPEG_BIN=/opt/homebrew/bin/ffmpeg payload-video-worker \
  --no-default-env \
  --config ./dist-config/videoPluginOptions.js \
  --payload-config ./dist-config/payload.worker.config.js \
  --env .env \
  --env .env.development \
  --static-dir ./public/media
```

Prefer a fully programmatic setup? Import `createWorker` directly and pass the
same options object you provide to the plugin.

### Step 6: Use the Admin UI

In the Admin UI a "Video processing" panel appears on any upload collection that accepts `video/*` mime types. Editors can enqueue presets, preview variants, replace the original file with a processed version, or delete unwanted variants without writing custom endpoints.

### Recommended host project scripts (example)

Most projects bundle both the plugin options and a minimal Payload config for the worker:

```jsonc
{
  "scripts": {
    "bundle:video-plugin-options": "tsup src/videoPluginOptions.ts --format esm --platform node --target es2022 --out-dir dist-config --minify",
    "bundle:payload-worker-config": "tsup worker/payload.worker.config.ts --format esm --platform node --target es2022 --out-dir dist-config --minify",
    "video:worker": "pnpm bundle:payload-worker-config && pnpm bundle:video-plugin-options && payload-video-worker --config ./dist-config/videoPluginOptions.js --payload-config ./dist-config/payload.worker.config.js",
    "video:worker:dev": "pnpm bundle:payload-worker-config && pnpm bundle:video-plugin-options && FFMPEG_BIN=/opt/homebrew/bin/ffmpeg payload-video-worker --no-default-env --config ./dist-config/videoPluginOptions.js --payload-config ./dist-config/payload.worker.config.js --env .env --env .env.development --static-dir ./public/media",
  },
}
```

## Example project (repo)

This repository also includes `apps/example-payload`, a **CLI-only** reference
project that demonstrates plugin configuration + worker processing without
shipping a full `/admin` UI app. See `apps/example-payload/README.md`.

## Scripts

- `pnpm build` – bundles ESM/CJS + admin assets via `tsup`.
- `pnpm dev` – watch mode build useful during plugin development.
- `pnpm typecheck` – `tsc --noEmit` for type validation.
- `pnpm test` – unit tests for helper utilities using Vitest.
- `pnpm worker` – development helper that runs the compiled worker entry.
  (Application projects should prefer the `payload-video-worker` CLI.)

## Environment variables

| Variable                                          | Purpose                                                                      |
| ------------------------------------------------- | ---------------------------------------------------------------------------- |
| `REDIS_URL`                                       | Default Redis connection string for queue + worker.                          |
| `FFMPEG_BIN`                                      | Optional path to a system ffmpeg binary (overrides `ffmpeg-static`).         |
| `STATIC_DIR`                                      | Base media directory for the worker (used when resolving paths).             |
| `PAYLOAD_SECRET` / `DATABASE_URI` / `MONGODB_URI` | Required to bootstrap the Payload local API from the worker.                 |
| `PAYLOAD_REST_URL` + `PAYLOAD_ADMIN_TOKEN`        | REST fallback when local init is not possible.                               |
| `PAYLOAD_PUBLIC_URL` / `PAYLOAD_SERVER_URL`       | Alternative base URL for REST fallback if `PAYLOAD_REST_URL` is not set.     |
| `PAYLOAD_CONFIG_PATH`                             | Absolute/relative path to the host `payload.config.ts` for worker bootstrap. |

## Customising output paths

Provide a `resolvePaths` function to control where variants are written:

```ts
videoPlugin({
  presets,
  resolvePaths: ({ original, presetName }) => ({
    dir: path.join("/data/videos", presetName),
    filename: `${path.parse(original.filename).name}.${presetName}.mp4`,
    url: `/videos/${presetName}/${path.parse(original.filename).name}.mp4`,
  }),
});
```

## Worker CLI

The installed binary `payload-video-worker` bootstraps environment variables,
loads your exported plugin options, and starts the queue worker. It automatically
loads `.env`, `.env.local`, `.env.development`, and `.env.production` (unless you
pass `--no-default-env`). Supply `--env` to load additional files, `--config` to
point at the bundled options module, `--payload-config` when you want the worker
to initialise Payload locally, and `--static-dir` if your media folder is not
`./public/media`.

```bash
payload-video-worker \
  --config ./dist-config/videoPluginOptions.js \
  --payload-config ./dist-config/payload.worker.config.js \
  --env .env \
  --env cms/.env
```

The CLI sets common fallbacks (`STATIC_DIR`, `PAYLOAD_CONFIG_PATH`,
`MONGODB_URI` ← `DATABASE_URI`, default `PAYLOAD_SECRET`) before invoking
`createWorker`. It shuts down gracefully on `SIGINT`/`SIGTERM`.

## Contributing

Contributions are welcome. Please open an issue or PR with a clear description
of the change and how to test it. If you add features, include a short README
note so onboarding stays accurate.
