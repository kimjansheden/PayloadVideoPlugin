# Payload Video Processor Monorepo

This workspace contains the `@kimjansheden/payload-video-processor` plugin and a
reference Payload CMS project that demonstrates queued video processing with
BullMQ and FFmpeg.

## Packages

- `packages/video-plugin` – the plugin source. Provides queue-backed video
  variants, Admin UI controls, and a worker helper.
- `apps/example-payload` – minimal Payload project wired up with the plugin.

## Getting started

Install dependencies with pnpm:

```bash
pnpm install
```

## Scripts

The two most common workflows are building the packages and exercising the
plugin’s test suite. Use the shorthand commands **from the repo root**:

- `pnpm build` – runs `build` in every package (plugin + example app). Use this
  when you need fresh `dist/` output for local linking or production deploys.
- `pnpm plugin:test` – executes the plugin’s unit tests only. Ideal for quick
  validation while you iterate on helpers such as ffmpeg arg builders.

When developing locally you can pair these with the watch targets:

- `pnpm plugin:dev` – rebuilds the plugin with `tsup --watch`. Keep this running
  while another project links to the plugin so `dist/` stays up to date.
- `pnpm dev` – starts the example Payload server in watch/dev mode.
- `pnpm worker` – runs the example worker process against the queue.

Additional utilities:

- `pnpm plugin:build` – one-off plugin build.
- `pnpm plugin:typecheck` – strict TypeScript check for the plugin source.
- `pnpm test` / `pnpm lint` / `pnpm typecheck` – monorepo-wide variants that run
  in every workspace where the script is defined.

The example project expects MongoDB, Redis, and standard Payload environment
variables (`PAYLOAD_SECRET`, `MONGODB_URI`, `REDIS_URL`, etc.).
