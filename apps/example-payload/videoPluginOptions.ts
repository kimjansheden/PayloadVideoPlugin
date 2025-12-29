import type { VideoPluginOptions } from "@kimjansheden/payload-video-processor";

const videoPluginOptions: VideoPluginOptions = {
  presets: {
    mobile360: {
      label: "360p Mobile",
      args: ["-vf", "scale=-2:360", "-crf", "32"],
    },
    hd720: {
      label: "720p HD",
      args: ["-vf", "scale=-2:720", "-crf", "24"],
      enableCrop: true,
    },
  },
  queue: {
    name: "video-transcode",
    redisUrl: process.env.REDIS_URL,
    concurrency: 1,
  },
};

export default videoPluginOptions;
