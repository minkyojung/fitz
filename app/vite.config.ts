import { resolve } from "node:path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig, searchForWorkspaceRoot } from "vite"

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname, "./src"),
    },
  },
  // the page folds a conversation with the server's own fold (docs/agent.md §17): the dev server may serve that file
  server: {
    fs: { allow: [searchForWorkspaceRoot(process.cwd()), resolve(import.meta.dirname, "../server/agent/fold.mjs")] },
  },
})
