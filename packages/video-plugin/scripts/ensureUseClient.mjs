import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));

const addUseClientDirective = (relativePath) => {
  const filePath = path.join(scriptDir, "..", relativePath);

  if (!fs.existsSync(filePath)) {
    return;
  }

  const original = fs.readFileSync(filePath, "utf8");

  if (
    original.startsWith('"use client";') ||
    original.startsWith("'use client';")
  ) {
    return;
  }

  const updated = `"use client";\n${original}`;
  fs.writeFileSync(filePath, updated, "utf8");
};

addUseClientDirective("dist/admin/VideoField.js");
addUseClientDirective("dist/admin/VideoField.cjs");

// Also ensure the explicit client entry used by Payload's import map
// (`@kimjansheden/payload-video-processor/client`) is always treated
// as a client component by Next/React.
addUseClientDirective("dist/exports/client.js");
addUseClientDirective("dist/exports/client.cjs");
