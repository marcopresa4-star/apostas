// Vitest runs the pure libs and components directly, outside Next, so the
// "@/..." alias has to be declared here too (a component that imports
// "@/lib/chartTheme" otherwise fails to load in the tests that touch it).
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
  },
});
