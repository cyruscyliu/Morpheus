import { defineConfig, type Plugin, type ViteDevServer } from "vite";
import { createRunsViewerServer } from "./src/server/dev-server.js";

function runsViewerPlugin(): Plugin {
  return {
    name: "morpheus:runs-viewer",
    configureServer(server: ViteDevServer) {
      const handlers = createRunsViewerServer({
        projectRoot: server.config.root,
      });
      server.middlewares.use(handlers.middleware);
      server.httpServer?.once("close", () => {
        handlers.close();
      });
    },
  };
}

export default defineConfig({
  root: "src",
  base: "./",
  publicDir: false,
  server: {
    fs: {
      allow: ["../.."],
    },
  },
  plugins: [runsViewerPlugin()],
  build: {
    outDir: "../dist",
    emptyOutDir: true,
  },
});
