import { defineConfig } from "vite";

export default defineConfig({
  root: "src",
  base: "./",
  publicDir: false,
  server: {
    fs: {
      allow: ["../.."],
    },
  },
  build: {
    outDir: "../dist",
    emptyOutDir: true,
  },
});
