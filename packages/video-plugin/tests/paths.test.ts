import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  defaultResolvePaths,
  buildStoredPath,
  buildWritePath,
} from "../src/utils/paths";

describe("paths helpers", () => {
  it("derives variant filenames next to the source file", () => {
    const result = defaultResolvePaths({
      doc: {},
      collection: { slug: "media" } as any,
      collectionSlug: "media",
      original: {
        filename: "example.mp4",
        path: "/var/media/example.mp4",
        url: "/media/example.mp4",
      },
      presetName: "hd720",
    });

    expect(result.filename).toBe("example_hd720.mp4");
    expect(result.dir).toBe("/var/media");
    expect(result.url).toBe("/media/example_hd720.mp4");
  });

  it("handles relative storage paths", () => {
    const result = defaultResolvePaths({
      doc: {},
      collection: { slug: "media" } as any,
      collectionSlug: "media",
      original: {
        filename: "clip.mov",
        path: "media/clip.mov",
        url: "/media/clip.mov",
      },
      presetName: "mobile",
    });

    expect(result.filename).toBe("clip_mobile.mov");
    expect(result.dir).toBe(path.join(process.cwd(), "media"));
    expect(result.url).toBe("/media/clip_mobile.mov");
  });

  it("combines stored and write paths correctly", () => {
    const stored = buildStoredPath("media/clip.mov", "clip_mobile.mov");
    const write = buildWritePath("/var/media", "clip_mobile.mov");

    expect(stored).toBe(path.join("media", "clip_mobile.mov"));
    expect(write).toBe(path.join("/var/media", "clip_mobile.mov"));
  });
});
