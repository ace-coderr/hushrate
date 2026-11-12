import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { cpSync, existsSync, mkdirSync, createReadStream, statSync } from "node:fs";
import { resolve, join, normalize } from "node:path";

const DATA = resolve(__dirname, "../data");
// Only the published market data is served; discovery dumps and probe files stay in the repo.
const PUBLISHED = ["latest.json", "history.json", "status.json", "ledger.json", "ticker.json", "market", "receipts"];

/** Serves ../data at /data in dev and copies the published subset into dist/data on build. */
function publishData(): Plugin {
  return {
    name: "hushrate-publish-data",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const m = /^\/data\/([^?]+)/.exec(req.url ?? "");
        if (!m) return next();
        const p = normalize(join(DATA, decodeURIComponent(m[1])));
        const top = p.slice(DATA.length + 1).split(/[\\/]/)[0];
        if (!p.startsWith(DATA) || !PUBLISHED.includes(top) || !existsSync(p) || !statSync(p).isFile()) { res.statusCode = 404; return res.end("not found"); }
        res.setHeader("Content-Type", "application/json");
        createReadStream(p).pipe(res);
      });
    },
    closeBundle() {
      const out = resolve(__dirname, "dist/data");
      mkdirSync(out, { recursive: true });
      for (const name of PUBLISHED) if (existsSync(join(DATA, name))) cpSync(join(DATA, name), join(out, name), { recursive: true });
    },
  };
}

export default defineConfig({
  base: process.env.VITE_BASE ?? "/",
  plugins: [react(), publishData()],
  server: { fs: { allow: [".."] } },
});
