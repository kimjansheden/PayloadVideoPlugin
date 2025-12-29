import ffmpeg from "fluent-ffmpeg";
import ffprobeStatic from "ffprobe-static";

export type VideoMetadata = {
  width?: number;
  height?: number;
  duration?: number;
  bitrate?: number;
};

if (ffprobeStatic.path) {
  ffmpeg.setFfprobePath(ffprobeStatic.path);
}

export const probeVideo = async (filePath: string): Promise<VideoMetadata> =>
  new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (error, metadata) => {
      if (error) {
        reject(error);
        return;
      }

      const videoStream = metadata.streams.find(
        (stream) => stream.codec_type === "video",
      );
      const width = videoStream?.width;
      const height = videoStream?.height;

      const durationRaw = videoStream?.duration ?? metadata.format?.duration;
      const duration =
        typeof durationRaw !== "undefined" ? Number(durationRaw) : undefined;

      const bitrateRaw = videoStream?.bit_rate ?? metadata.format?.bit_rate;
      const bitrate =
        typeof bitrateRaw !== "undefined" ? Number(bitrateRaw) : undefined;

      resolve({
        width: width ?? undefined,
        height: height ?? undefined,
        duration: Number.isNaN(duration) ? undefined : duration,
        bitrate: Number.isNaN(bitrate) ? undefined : bitrate,
      });
    });
  });
