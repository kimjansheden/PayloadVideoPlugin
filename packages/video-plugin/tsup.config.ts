import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: {
      index: "src/index.ts",
      "queue/worker": "src/queue/worker.ts",
      "admin/VideoField": "src/admin/VideoField.tsx",
      "exports/client": "src/admin/client.ts",
    },
    dts: {
      entry: [
        "src/index.ts",
        "src/queue/worker.ts",
        "src/admin/VideoField.tsx",
        "src/admin/client.ts",
      ],
    },
    format: ["esm", "cjs"],
    target: "node18",
    sourcemap: true,
    clean: true,
    splitting: false,
    treeshake: true,
    shims: false,
    external: ["react", "react-dom", "@payloadcms/ui"],
    loader: {
      ".css": "copy",
    },
  },
  {
    entry: {
      "cli/start-worker": "src/cli/start-worker.ts",
    },
    dts: false,
    format: ["esm", "cjs"],
    target: "node18",
    sourcemap: true,
    clean: false,
    splitting: false,
    treeshake: true,
    shims: false,
    banner: {
      js: "#!/usr/bin/env node",
    },
  },
]);
