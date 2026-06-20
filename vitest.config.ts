import { defineConfig } from "vitest/config";

// Tests target the pure layers (solver/, idmt, arcFlash, protection), which are
// React-free — so a plain Node environment keeps the suite fast (no jsdom).
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
