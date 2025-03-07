/// <reference types="vitest" />
import { defineConfig } from "vite";

import react from "@vitejs/plugin-react-swc";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  worker: {
    format: "es",
  },
  build: {
    target: "es2022",
  },
  define: {
    "import.meta.vitest": "undefined",
  },
  test: {
    include: "src/**/*.ts",
    exclude: "**/*.d.ts",
    passWithNoTests: true,
  },
});
