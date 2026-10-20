import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Path B: React + Framer Motion layer → static site assets (Wrangler-safe). */
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: path.resolve(__dirname, "../website/assets/js/sokoni-motion"),
    emptyOutDir: true,
    lib: {
      entry: path.resolve(__dirname, "src/main.jsx"),
      name: "SokoniMotion",
      formats: ["iife"],
      fileName: () => "sokoni-motion.js",
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
        assetFileNames: "sokoni-motion.[ext]",
      },
    },
    sourcemap: true,
    target: "es2018",
    cssCodeSplit: false,
  },
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
});
