import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // ECharts is imported module by module (charts/echarts.ts). Named here so
  // the dev server bundles those entry points up front, instead of
  // discovering them on the first chart and reloading the page mid-session.
  optimizeDeps: {
    include: [
      "echarts/core",
      "echarts/charts",
      "echarts/components",
      "echarts/features",
      "echarts/renderers",
    ],
  },
  server: {
    // 5173 unless the environment names another. Two agent sessions open on
    // the same checkout were fighting over the port: the second silently fell
    // through to 5174 while the browser preview kept pointing at an empty one.
    // `.claude/launch.json` carries `autoPort`, which hands the assigned port
    // over in PORT -- but only if something reads it.
    port: Number(process.env.PORT) || 5173,
    proxy: { "/api": { target: "http://localhost:8000", changeOrigin: true } },
  },
  build: {
    outDir: "dist",
    sourcemap: false,
    rolldownOptions: {
      output: {
        // The charting library is the one dependency every screen with a
        // chart shares and none of the others need: its own chunk is fetched
        // once, on the first chart, and cached across every route-level chunk
        // that would otherwise each carry a slice of it. ECharts draws through
        // zrender, which travels with it.
        codeSplitting: {
          groups: [{ name: "echarts", test: /node_modules[\\/](echarts|zrender)[\\/]/ }],
        },
      },
    },
  },
});
