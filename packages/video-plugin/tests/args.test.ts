import { describe, expect, it } from "vitest";
import { buildFfmpegArgs } from "../src/ffmpeg/args";

describe("buildFfmpegArgs", () => {
  it("adds default CRF and faststart flags", () => {
    const { outputOptions, globalOptions } = buildFfmpegArgs({
      presetArgs: ["-c:v", "libx264"],
    });

    expect(globalOptions).toContain("-y");
    expect(outputOptions).toContain("-crf");
    expect(outputOptions).toContain("24");
    expect(outputOptions).toContain("-movflags");
    expect(outputOptions).toContain("+faststart");
  });

  it("preserves custom CRF values", () => {
    const { outputOptions } = buildFfmpegArgs({
      presetArgs: ["-c:v", "libx264", "-crf", "20"],
    });

    const crfIndex = outputOptions.indexOf("-crf");
    expect(crfIndex).toBeGreaterThan(-1);
    expect(outputOptions[crfIndex + 1]).toBe("20");
  });

  it("merges crop instructions into the filter chain", () => {
    const { outputOptions } = buildFfmpegArgs({
      presetArgs: ["-vf", "scale=-2:720"],
      crop: { x: 0, y: 0, width: 0.5, height: 0.5 },
      dimensions: { width: 1920, height: 1080 },
    });

    const filterIndex = outputOptions.indexOf("-vf");
    expect(filterIndex).toBeGreaterThan(-1);
    const filterValue = outputOptions[filterIndex + 1];
    expect(filterValue).toContain("scale=-2:720");
    expect(filterValue).toContain("crop=960:540:0:0");
  });
});
