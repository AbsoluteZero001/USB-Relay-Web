import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import electron from "vite-plugin-electron";
import renderer from "vite-plugin-electron-renderer";

export default defineConfig({
  plugins: [
    vue(),
    electron([
      {
        entry: "electron/main/index.ts",
        vite: {
          build: {
            outDir: "dist-electron/main",
            rollupOptions: {
              external: ["serialport", "@serialport/bindings-cpp", "electron-store"],
            },
          },
        },
      },
      {
        entry: "electron/preload/index.ts",
        vite: {
          build: {
            outDir: "dist-electron/preload",
            rollupOptions: {
              output: {
                entryFileNames: "index.mjs",
              },
            },
          },
        },
      },
    ]),
    renderer(),
  ],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: "dist-electron/renderer",
    emptyOutDir: true,
  },
});
