import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // 5173 unless the environment names another. Two agent sessions open on
    // the same checkout were fighting over the port: the second silently fell
    // through to 5174 while the browser preview kept pointing at an empty one.
    // `.claude/launch.json` carries `autoPort`, which hands the assigned port
    // over in PORT -- but only if something reads it.
    port: Number(process.env.PORT) || 5173,
    proxy: { "/api": { target: "http://localhost:8000", changeOrigin: true } },
  },
  build: { outDir: "dist", sourcemap: false },
});
