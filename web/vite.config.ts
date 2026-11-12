import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Receipts live in ../data and are bundled at build time; allow the dev server to read them.
export default defineConfig({
  plugins: [react()],
  server: { fs: { allow: [".."] } },
});
