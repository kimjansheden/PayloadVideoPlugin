import { describe, expect, it } from "vitest";
import type { PayloadRequest } from "payload";

import {
  buildPlaybackPosterUrl,
  buildPlaybackSources,
} from "../src/utils/playback";

describe("playback helpers", () => {
  it("builds playbackSources with absolute URLs and normalised types", () => {
    const doc = {
      url: "http://localhost:3000/api/media/file/Screen%20Recording.mov",
      mimeType: "video/quicktime",
      thumbnailURL: "/video-placeholder.svg",
      playbackPosterUrl: "/api/media/file/Screen Recording_poster.jpg",
      variants: [
        {
          preset: "hd1080",
          url: "/api/media/file/Screen Recording_hd1080.mov",
          size: 200,
          path: "/tmp/Screen Recording_hd1080.mov",
          createdAt: new Date().toISOString(),
        },
        {
          preset: "sd480",
          url: "/api/media/file/Screen Recording_sd480.mov",
          size: 100,
          path: "/tmp/Screen Recording_sd480.mov",
          createdAt: new Date().toISOString(),
        },
      ],
    };

    const sources = buildPlaybackSources({
      doc,
      req: {
        payload: { config: { serverURL: "http://localhost:3000" } },
      } as PayloadRequest,
    });

    expect(sources).toHaveLength(3);
    expect(sources[0]).toEqual({
      preset: "hd1080",
      src: "http://localhost:3000/api/media/file/Screen%20Recording_hd1080.mov",
      type: "video/mp4",
    });
    expect(sources[1]).toEqual({
      preset: "sd480",
      src: "http://localhost:3000/api/media/file/Screen%20Recording_sd480.mov",
      type: "video/mp4",
    });
    expect(sources[2]).toEqual({
      src: "http://localhost:3000/api/media/file/Screen%20Recording.mov",
      type: "video/mp4",
    });

    const posterUrl = buildPlaybackPosterUrl({
      doc,
      req: {
        payload: { config: { serverURL: "http://localhost:3000" } },
      } as PayloadRequest,
    });

    expect(posterUrl).toBe(
      "http://localhost:3000/api/media/file/Screen%20Recording_poster.jpg",
    );
  });

  it("resolves relative doc.url via serverURL when needed", () => {
    const sources = buildPlaybackSources({
      doc: {
        url: "/api/media/file/example.mov",
        mimeType: "video/quicktime",
        variants: [],
      },
      req: {
        payload: { config: { serverURL: "https://example.com" } },
      } as PayloadRequest,
    });

    expect(sources).toEqual([
      {
        src: "https://example.com/api/media/file/example.mov",
        type: "video/mp4",
      },
    ]);
  });
});
