import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.{ts,tsx,mjs}"],
    // This workspace lives on an exFAT volume, so macOS drops AppleDouble
    // `._name` sidecars next to every file. They match the include glob and
    // are not valid UTF-8, so keep them out.
    exclude: ["**/node_modules/**", "**/dist/**", "**/._*", "**/.v2c/**"],
  },
});
