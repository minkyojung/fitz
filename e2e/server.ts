// The real server for the browser tests: started as the shell starts it (settings over the IPC channel), serving
// the built page and the development copy of the book.
import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { join, resolve } from "node:path"
import { DatabaseSync } from "node:sqlite"

import { test as base, expect } from "@playwright/test"

const ROOT = resolve(import.meta.dirname, "..")
export const COPY = process.env.FITZ_DB ?? join(ROOT, "dev-data/out/book.db")
const CLIENT = join(ROOT, "app/dist")
const TOKEN = "e".repeat(48)

interface Fixtures {
  /** The address the shell would open: it carries the token once. */
  door: string
  /** The development copy, for counting what the page should show. */
  sql: DatabaseSync
  /** What the browser complained of. A test that causes failures on purpose empties it before it ends. */
  complaints: string[]
}

export const test = base.extend<Pick<Fixtures, "complaints">, Omit<Fixtures, "complaints">>({
  door: [async ({}, use) => {
    if (!existsSync(COPY)) throw new Error(`no development copy at ${COPY} — make it with: scripts/dev-data.sh`)
    if (!existsSync(join(CLIENT, "index.html"))) throw new Error(`no built page at ${CLIENT} — build it with: pnpm --dir app build`)
    const child = spawn(process.execPath, [join(ROOT, "server/main.ts")], { stdio: ["ignore", "inherit", "inherit", "ipc"] })
    const port = await new Promise<number>((done, fail) => {
      child.once("message", (m: { ready: { port: number } }) => done(m.ready.port))
      child.once("exit", (code) => fail(new Error(`the server ended with ${code} before it was ready`)))
      child.send({ start: { port: 0, token: TOKEN, dbPath: COPY, clientDir: CLIENT } })
    })
    await use(`http://127.0.0.1:${port}/?token=${TOKEN}`)
    child.kill("SIGTERM")
    await new Promise((done) => child.once("exit", done))
  }, { scope: "worker" }],

  sql: [async ({}, use) => {
    const db = new DatabaseSync(COPY, { readOnly: true })
    await use(db)
    db.close()
  }, { scope: "worker" }],

  complaints: [async ({ page }, use) => {
    const complaints: string[] = []
    page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") complaints.push(`${m.type()}: ${m.text()}`) })
    page.on("pageerror", (e) => complaints.push(`page error: ${e.message}`))
    await use(complaints)
    expect(complaints, "the browser's console has no errors or warnings (a blocked resource would show here)").toEqual([])
  }, { auto: true }],
})

export { expect }
