import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // Relative base so built assets load correctly when served from a GitHub
  // Pages subpath (https://<user>.github.io/<repo>/).
  base: "./",
  plugins: [react()],
  server: {
    port: 5000,
    host: "0.0.0.0",
    allowedHosts: true,
  },
});
