# example-payload (CLI example)

This app is **not** a full Payload + Next.js Admin UI project.
It exists as a small, scriptable reference that demonstrates:

- How to import + configure `@kimjansheden/payload-video-processor`.
- How to run the **worker process** (BullMQ + FFmpeg) against Redis.
- How video uploads are stored on disk and updated with `variants[]`.

It does **not** demonstrate:

- A real `/admin` UI (there is no Next.js app here).
- Clicking the "Video processing" field UI. (Use a real host project for that.)

## Prerequisites

- Node.js + pnpm
- MongoDB
- Redis

Quick option (Docker):

```bash
docker compose up -d
```

## Configure env

Copy the sample env file and adjust values as needed:

```bash
cp .env.example .env
```

Key variables:

- `MONGODB_URI`
- `REDIS_URL`
- `PAYLOAD_SECRET`
- `PAYLOAD_PUBLIC_URL` (only used for generated URLs)
- `VIDEO_STORAGE_PATH` (where uploads are stored on disk)

## Run the worker (terminal 1)

From the monorepo root:

```bash
pnpm worker
```

Or from this folder:

```bash
pnpm worker
```

## Run the CLI demo (terminal 2)

The demo creates an upload document using the local API (`filePath`) which
triggers the plugin's `autoEnqueue` hook. The worker then processes the job and
updates the document with a new entry in `variants[]`.

```bash
pnpm demo
```

If you want to use an existing video file instead of generating one:

```bash
pnpm demo -- --file /absolute/path/to/video.mp4
```

## Quick config sanity check

```bash
pnpm check
```
