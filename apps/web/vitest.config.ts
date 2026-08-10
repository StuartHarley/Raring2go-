import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@raring2go/ui": resolve(import.meta.dirname, "../../packages/ui/src/index.ts"),
      "react/jsx-dev-runtime": resolve(import.meta.dirname, "node_modules/react/jsx-dev-runtime.js"),
      "react/jsx-runtime": resolve(import.meta.dirname, "node_modules/react/jsx-runtime.js"),
      react: resolve(import.meta.dirname, "node_modules/react/index.js")
    }
  },
  test: {
    environment: "jsdom",
    globals: true
  }
});
