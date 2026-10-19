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
  // the page uses the server's own fold and glossary rule (docs/agent.md §17, §19): the dev server may serve those files
  server: {
    fs: { allow: [searchForWorkspaceRoot(process.cwd()), ...["fold.mjs", "glossaryRule.mjs"].map((f) => resolve(import.meta.dirname, "../server/agent", f))] },
  },
})
