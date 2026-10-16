import { defineConfig } from "@playwright/test"

// e2e runs against a scratch copy of the book database so tests never touch out/book.db.
export default defineConfig({
  testDir: "e2e",
  timeout: 30_000,
  use: { baseURL: "http://localhost:4173", viewport: { width: 1400, height: 800 } },
  webServer: [
    {
      command: "cp ../out/book.db /tmp/fitz-e2e.db && node ../server/index.mjs --db /tmp/fitz-e2e.db --pages ../out/pages --port 4801",
      url: "http://localhost:4801/pages/page-021.png",
      reuseExistingServer: false,
    },
    {
      command: "VITE_API_URL=http://localhost:4801 pnpm build && pnpm preview --port 4173",
      url: "http://localhost:4173",
      reuseExistingServer: false,
    },
  ],
})
