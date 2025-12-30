import type { VideoPluginOptions } from "@kimjansheden/payload-video-processor";

const presets = {
  hd1080: {
    label: "Full HD 1080p",
    args: ["-vf", "scale=-2:min(1080\\,ih)"],
    enableCrop: true,
  },
  hd720: {
    label: "HD 720p",
    args: ["-vf", "scale=-2:min(720\\,ih)"],
  },
  mobile360: {
    label: "Mobile 360p",
    args: ["-vf", "scale=-2:min(360\\,ih)", "-b:v", "1200k"],
  },
} satisfies VideoPluginOptions["presets"];

type PresetName = keyof typeof presets;

const videoPluginOptions: VideoPluginOptions<PresetName> = {
  presets,
  queue: {
    name: "video-transcode",
    redisUrl: process.env.REDIS_URL,
    concurrency: 1,
  },
  autoEnqueue: true,
  autoEnqueuePreset: "mobile360",
  autoReplaceOriginal: false,
};

export default videoPluginOptions;
