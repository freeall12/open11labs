import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

/** Where the local API lives during development. */
const API_TARGET = process.env.EL_API_TARGET ?? "http://127.0.0.1:5174";
const API_ORIGIN = new URL(API_TARGET).host;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    port: 5173,
    /**
     * The server emits no CORS headers and rejects any Host/Origin that is
     * not its own, so the browser can only reach it same-origin. The dev proxy
     * reproduces the production topology — one origin serving both the app and
     * the API — rather than teaching the server to relax its checks for dev.
     *
     * Host and Origin are both rewritten to the API's own origin, so the
     * request that reaches the server is indistinguishable from one the server
     * served itself.
     */
    proxy: {
      "/api": {
        target: API_TARGET,
        changeOrigin: true,
        configure(proxy) {
          proxy.on("proxyReq", (proxyReq) => {
            proxyReq.setHeader("host", API_ORIGIN);
            proxyReq.setHeader("origin", `http://${API_ORIGIN}`);
          });
        },
      },
    },
  },
});
