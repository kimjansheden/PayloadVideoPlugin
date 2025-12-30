# @kimjansheden/payload-video-processor

Queued FFmpeg-based video variant generation for Payload CMS. The plugin mirrors
Payload's image size workflow for videos by adding a `variants[]` array to video
collections and exposing an Admin UI that lets editors enqueue transcoding jobs.
Designed to be plug-and-play: no custom endpoints, no extra UI code in the
consumer project.

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
system ffmpeg binary.

## Quick start

1. Define presets and register the plugin in your `payload.config.ts`:

```ts
import { buildConfig } from "payload/config";
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
  autoEnqueuePreset: "hd1080",
  // Optional: replace the original with the auto-generated variant.
  autoReplaceOriginal: true,
};

export default buildConfig({
  db: mongooseAdapter({ url: process.env.MONGODB_URI ?? "" }),
  collections: [
    /* … */
  ],
  plugins: [videoPlugin(videoOptions)],
});
```

When `autoEnqueue` is `true`, the plugin
tries a preset named `1080`, then `hd1080`, and finally falls back to the first
configured preset.
Set `autoEnqueuePreset` to force a specific preset name when auto-enqueueing.

2. Provide a worker options module and bundle it to JS (the CLI needs a JS file).
   Example setup:

```ts
// src/videoPluginOptions.ts
export default videoOptions;
```

```bash
tsup src/videoPluginOptions.ts --format esm --platform node --target es2022 --out-dir dist-config --minify
```

3. Start a worker in a separate process:

```bash
payload-video-worker \
  --config ./dist-config/videoPluginOptions.js \
  --env .env
```

If you want the worker to initialize Payload locally, also pass
`--payload-config` and ensure `PAYLOAD_SECRET` + `MONGODB_URI` are set. If you
prefer the REST fallback, omit `--payload-config` and provide
`PAYLOAD_REST_URL` + `PAYLOAD_ADMIN_TOKEN`.

The CLI loads `.env`, `.env.local`, `.env.development`, and `.env.production`
automatically (unless you pass `--no-default-env`). Additional `--env` flags can
point to project-specific files.

Prefer a fully programmatic setup? Import `createWorker` directly and pass the
same options object you provide to the plugin.

4. In the Admin UI a "Video processing" panel appears on any upload collection
   that accepts `video/*` mime types. Editors can enqueue presets, preview
   variants, replace the original file with a processed version, or delete
   unwanted variants without writing custom endpoints.

## Scripts

- `pnpm build` – bundles ESM/CJS + admin assets via `tsup`.
- `pnpm dev` – watch mode build useful during plugin development.
- `pnpm typecheck` – `tsc --noEmit` for type validation.
- `pnpm test` – unit tests for helper utilities using Vitest.
- `pnpm worker` – development helper that runs the compiled worker entry.
  (Application projects should prefer the `payload-video-worker` CLI.)

## Environment variables

| Variable                                    | Purpose                                                                      |
| ------------------------------------------- | ---------------------------------------------------------------------------- |
| `REDIS_URL`                                 | Default Redis connection string for queue + worker.                          |
| `FFMPEG_BIN`                                | Optional path to a system ffmpeg binary (overrides `ffmpeg-static`).         |
| `STATIC_DIR`                                | Base media directory for the worker (used when resolving paths).             |
| `PAYLOAD_SECRET` / `MONGODB_URI`            | Required to bootstrap the Payload local API from the worker.                 |
| `PAYLOAD_REST_URL` + `PAYLOAD_ADMIN_TOKEN`  | REST fallback when local init is not possible.                               |
| `PAYLOAD_PUBLIC_URL` / `PAYLOAD_SERVER_URL` | Alternative base URL for REST fallback if `PAYLOAD_REST_URL` is not set.     |
| `PAYLOAD_CONFIG_PATH`                       | Absolute/relative path to the host `payload.config.ts` for worker bootstrap. |

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
