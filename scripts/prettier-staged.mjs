import { spawnSync } from "node:child_process";

const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, { stdio: "inherit", ...options });

  if (result.error) {
    throw result.error;
  }

  if (typeof result.status === "number" && result.status !== 0) {
    process.exit(result.status);
  }

  return result;
};

const readStagedFiles = () => {
  const result = spawnSync(
    "git",
    ["diff", "--cached", "--name-only", "-z", "--diff-filter=ACMR"],
    { encoding: "buffer" },
  );

  if (result.error) {
    throw result.error;
  }

  if (typeof result.status === "number" && result.status !== 0) {
    if (result.stderr) {
      process.stderr.write(result.stderr);
    }
    process.exit(result.status);
  }

  const stdout =
    result.stdout instanceof Buffer ? result.stdout.toString("utf8") : "";

  return stdout.split("\0").filter(Boolean);
};

const chunk = (items, size) => {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
};

const stagedFiles = readStagedFiles();

if (stagedFiles.length === 0) {
  process.exit(0);
}

for (const files of chunk(stagedFiles, 50)) {
  run("pnpm", ["-w", "prettier", "--write", "--ignore-unknown", ...files]);
  run("git", ["add", ...files]);
}
