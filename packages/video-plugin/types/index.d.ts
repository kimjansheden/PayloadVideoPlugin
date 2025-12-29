export * from "../dist/index";
import type { Plugin } from "payload";
import type { VideoPluginOptions } from "../dist/index";

declare const pluginFactory: (options: VideoPluginOptions) => Plugin;
export default pluginFactory;
