import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import fs from "fs";
import path from "path";
import os from "os";

// Read the dynamic action file path passed from the batch script via environment variables.
const ACTION_FILE = process.env.ACTION_FILE || path.join(os.tmpdir(), `vite_action_fallback_${process.pid}.tmp`);

/**
 * CLI shortcuts in the terminal running `npm run dev`:
 * - `h`: git fetch & hard reset, then restart
 * - `p`: git pull, then restart
 * - `n`: npm install & audit fix, then restart
 */
function devShortcuts(): Plugin {
  return {
    name: "dev-shortcuts",
    apply: "serve",
    configureServer(server) {
      const bind = server.bindCLIShortcuts.bind(server);
      server.bindCLIShortcuts = (opts) =>
        bind({
          ...opts,
          customShortcuts: [
            ...(opts?.customShortcuts ?? []),
            {
              key: "h",
              description: "git fetch & hard reset, then restart",
              async action(server) {
                fs.writeFileSync(ACTION_FILE, "h", "utf-8");
                await server.close();
              },
            },
            {
              key: "p",
              description: "git pull, then restart",
              async action(server) {
                fs.writeFileSync(ACTION_FILE, "p", "utf-8");
                await server.close();
              },
            },
            {
              key: "n",
              description: "npm install & audit fix, then restart",
              async action(server) {
                fs.writeFileSync(ACTION_FILE, "n", "utf-8");
                await server.close();
              },
            },
          ],
        });
    },
  };
}

export default defineConfig({
  plugins: [react(), devShortcuts()],
  server: {
    host: true,
    port: 5173,
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
});