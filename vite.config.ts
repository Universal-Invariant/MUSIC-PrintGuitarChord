import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import fs from "fs";
import path from "path";
import os from "os";

// Unique per project so multiple vite instances don't fight over the same file.
const ACTION_FILE = path.join(os.tmpdir(), `vite_action_35ss442.tmp`);

/**
 * CLI shortcut: press `b` in the terminal running `npm run dev` to write a
 * "rebuild" marker and shut down the dev server. Pair with the `rerun` script
 * (`npm run dev:loop`) which sees the marker, rebuilds, and restarts vite.
 */
function rebuildShortcut(): Plugin {
  return {
    name: "rebuild-shortcut",
    apply: "serve",
    configureServer(server) {
      const bind = server.bindCLIShortcuts.bind(server);
      server.bindCLIShortcuts = (opts) =>
        bind({
          ...opts,
          customShortcuts: [
            ...(opts?.customShortcuts ?? []),
            {
              key: "b",
              description: "fetch, pull, rebuild and restart",
              async action(server) {
                fs.writeFileSync(ACTION_FILE, "rebuild", "utf-8");
                await server.close();
              },
            },
          ],
        });
    },
  };
}

export default defineConfig({
  plugins: [react(), rebuildShortcut()],
  server: {
    host: true, // or use '127.0.0.1' or 'localhost'
    port: 5173, // ensures it stays on your expected port
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
  inputOptions: {
    transform: {
      jsx: "react-jsx" // matches tsconfig.json
	}
  }
});
