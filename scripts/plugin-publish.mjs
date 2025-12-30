#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { execSync } from "node:child_process";
import { stdin as input, stdout as output } from "node:process";
import readline from "node:readline/promises";

const rootDir = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "..",
);
const packageJsonPath = path.join(
  rootDir,
  "packages",
  "video-plugin",
  "package.json",
);

const readJson = async (filePath) =>
  JSON.parse(await fs.readFile(filePath, "utf8"));

const writeJson = async (filePath, value) => {
  const formatted = `${JSON.stringify(value, null, 2)}\n`;
  await fs.writeFile(filePath, formatted, "utf8");
};

const parseSemver = (value) => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-.]+))?$/.exec(trimmed);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ?? null,
    raw: trimmed,
  };
};

const compareSemver = (a, b) => {
  const left = parseSemver(a);
  const right = parseSemver(b);
  if (!left || !right) {
    throw new Error(`Cannot compare semver values: "${a}" vs "${b}"`);
  }
  if (left.major !== right.major) return left.major - right.major;
  if (left.minor !== right.minor) return left.minor - right.minor;
  if (left.patch !== right.patch) return left.patch - right.patch;

  // Treat prerelease as lower than stable.
  if (left.prerelease && !right.prerelease) return -1;
  if (!left.prerelease && right.prerelease) return 1;
  if (left.prerelease === right.prerelease) return 0;
  return left.prerelease < right.prerelease ? -1 : 1;
};

const bumpSemver = (base, kind) => {
  const parsed = parseSemver(base);
  if (!parsed) throw new Error(`Invalid semver: "${base}"`);
  const next = { ...parsed, prerelease: null };

  switch (kind) {
    case "patch":
      next.patch += 1;
      break;
    case "minor":
      next.minor += 1;
      next.patch = 0;
      break;
    case "major":
      next.major += 1;
      next.minor = 0;
      next.patch = 0;
      break;
    default:
      throw new Error(`Unknown bump kind: "${kind}"`);
  }

  return `${next.major}.${next.minor}.${next.patch}`;
};

const run = (cmd, { env } = {}) => {
  execSync(cmd, {
    cwd: rootDir,
    stdio: "inherit",
    env: { ...process.env, ...env },
  });
};

const getLatestPublishedVersion = (pkgName) => {
  try {
    const raw = execSync(`npm view ${pkgName} version --json`, {
      cwd: rootDir,
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf8",
    }).trim();
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed[parsed.length - 1] ?? null;
    if (typeof parsed === "string") return parsed;
    return null;
  } catch {
    return null;
  }
};

const parseArgs = () => {
  const argv = process.argv.slice(2);
  const flags = new Set(argv.filter((arg) => arg.startsWith("--")));
  const getValue = (name) => {
    const idx = argv.indexOf(name);
    if (idx === -1) return null;
    return argv[idx + 1] ?? null;
  };

  return {
    check: flags.has("--check"),
    dryRun: flags.has("--dry-run"),
    bump: getValue("--bump"),
    setVersion: getValue("--set-version"),
    yes: flags.has("--yes") || flags.has("-y"),
  };
};

const promptBump = async ({ localVersion, publishedVersion }) => {
  const rl = readline.createInterface({ input, output });
  try {
    output.write(
      `\n@kimjansheden/payload-video-processor\n` +
        `- local:      ${localVersion}\n` +
        `- npm latest: ${publishedVersion}\n\n`,
    );
    output.write(
      "Välj version bump (default: patch).\n" +
        "  [p] patch  [m] minor  [M] major  [c] custom  [s] skip  [a] abort\n",
    );
    const answer = (await rl.question("> ")).trim();

    if (!answer || answer.toLowerCase() === "p" || answer === "patch") {
      return { kind: "bump", bump: "patch" };
    }
    if (answer.toLowerCase() === "m" || answer === "minor") {
      return { kind: "bump", bump: "minor" };
    }
    if (answer === "M" || answer === "major") {
      return { kind: "bump", bump: "major" };
    }
    if (answer.toLowerCase() === "c" || answer === "custom") {
      const custom = (
        await rl.question("Skriv version (t.ex. 0.1.17): ")
      ).trim();
      return { kind: "set", version: custom };
    }
    if (answer.toLowerCase() === "s" || answer === "skip") {
      return { kind: "skip" };
    }
    if (answer.toLowerCase() === "a" || answer === "abort") {
      return { kind: "abort" };
    }

    return { kind: "abort" };
  } finally {
    rl.close();
  }
};

const main = async () => {
  const args = parseArgs();
  const pkg = await readJson(packageJsonPath);
  const pkgName = pkg.name;
  const localVersion = pkg.version;

  if (typeof pkgName !== "string" || !pkgName) {
    throw new Error(`Missing package name in ${packageJsonPath}`);
  }
  if (!parseSemver(localVersion)) {
    throw new Error(
      `Invalid local version "${localVersion}" in ${packageJsonPath}`,
    );
  }

  const publishedVersion = getLatestPublishedVersion(pkgName) ?? "0.0.0";
  if (!parseSemver(publishedVersion)) {
    throw new Error(
      `Invalid npm version "${publishedVersion}" returned for ${pkgName}`,
    );
  }

  const localComparedToPublished = compareSemver(
    localVersion,
    publishedVersion,
  );
  const needsBump = localComparedToPublished <= 0;

  if (args.check) {
    output.write(
      `${pkgName}\n- local:      ${localVersion}\n- npm latest: ${publishedVersion}\n`,
    );
    if (needsBump) {
      output.write("Version needs bump before publishing.\n");
      process.exitCode = 1;
    } else {
      output.write("Version is OK for publishing.\n");
    }
    return;
  }

  let nextVersion = null;

  if (args.setVersion) {
    if (!parseSemver(args.setVersion)) {
      throw new Error(`Invalid --set-version "${args.setVersion}"`);
    }
    nextVersion = args.setVersion;
  } else if (args.bump) {
    if (!["patch", "minor", "major"].includes(args.bump)) {
      throw new Error(`Invalid --bump "${args.bump}" (use patch|minor|major)`);
    }
    const base = needsBump ? publishedVersion : localVersion;
    nextVersion = bumpSemver(base, args.bump);
  } else if (needsBump) {
    if (args.yes) {
      nextVersion = bumpSemver(publishedVersion, "patch");
    } else {
      const choice = await promptBump({ localVersion, publishedVersion });
      if (choice.kind === "abort") {
        process.exitCode = 1;
        return;
      }
      if (choice.kind === "skip") {
        output.write("Skipping version bump.\n");
      } else if (choice.kind === "set") {
        if (!parseSemver(choice.version)) {
          throw new Error(`Invalid version "${choice.version}"`);
        }
        nextVersion = choice.version;
      } else if (choice.kind === "bump") {
        nextVersion = bumpSemver(publishedVersion, choice.bump);
      }
    }
  } else {
    output.write(
      `No bump needed (local ${localVersion} > npm latest ${publishedVersion}).\n`,
    );
  }

  if (args.dryRun) {
    if (nextVersion) {
      output.write(
        `Dry-run: would set ${packageJsonPath} version to ${nextVersion}.\n`,
      );
    } else {
      output.write("Dry-run: no version change.\n");
    }
    return;
  }

  if (nextVersion) {
    pkg.version = nextVersion;
    await writeJson(packageJsonPath, pkg);
    output.write(`Updated ${packageJsonPath} -> version ${pkg.version}\n`);
  }

  // Build the plugin first.
  run("pnpm --filter @kimjansheden/payload-video-processor build");

  // Publish the plugin package directory (no scripts; we handle build ourselves).
  run("npm publish ./packages/video-plugin --access public --ignore-scripts", {
    env: { HUSKY: "0" },
  });
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
