import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";

const repoRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: "web",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      sourceflow: path.join(repoRoot, "packages/sourceflow/src"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:3847",
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on("proxyRes", (proxyRes, req) => {
            if (req.url?.includes("/stream")) {
              proxyRes.headers["cache-control"] = "no-cache, no-transform";
              proxyRes.headers["x-accel-buffering"] = "no";
            }
          });
        },
      },
    },
  },
  build: {
    outDir: "../dist/web",
    emptyOutDir: true,
  },
});