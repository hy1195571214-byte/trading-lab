import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  // node_modules may be a shared, read-only symlink in the local workspace.
  cacheDir: ".vite-local-cache",
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    watch: { usePolling: true, interval: 300 },
    proxy: { "/api": { target: "http://127.0.0.1:8000", changeOrigin: true } },
  },
});
