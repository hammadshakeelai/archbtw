// The base path follows the repository name, so a fork deploys under its own name.
import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://hammadshakeelai.github.io",
  base: process.env.BASE_PATH ?? "/archbtw/",
  trailingSlash: "always",
});
