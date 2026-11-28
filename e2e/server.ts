// The real server for the browser tests: started as the shell starts it (settings over the IPC channel), serving
// the built page and the development copy of the book.
import { spawn } from "node:child_process"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { DatabaseSync } from "node:sqlite"

import { test as base, expect } from "@playwright/test"

import { COPY, bookCopy } from "../server/testing.ts"

const ROOT = resolve(import.meta.dirname, "..")
export { COPY }
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
    if (!existsSync(join(CLIENT, "index.html"))) throw new Error(`no built page at ${CLIENT} — build it with: pnpm --dir app build`)
    // a copy of its own, as the prototype left it: the server migrates it before serving, as it will a real book
    const dir = mkdtempSync(join(tmpdir(), "fitz-e2e-"))
    const book = await bookCopy(dir, "prototype")
    const child = spawn(process.execPath, [join(ROOT, "server/main.ts")], { stdio: ["ignore", "inherit", "inherit", "ipc"] })
    const port = await new Promise<number>((done, fail) => {
      child.once("message", (m: { ready: { port: number } }) => done(m.ready.port))
      child.once("exit", (code) => fail(new Error(`the server ended with ${code} before it was ready`)))
      child.send({ start: { port: 0, token: TOKEN, dbPath: book.path, backupDir: book.backupDir, clientDir: CLIENT } })
    })
    await use(`http://127.0.0.1:${port}/?token=${TOKEN}`)
    child.kill("SIGTERM")
    await new Promise((done) => child.once("exit", done))
    rmSync(dir, { recursive: true, force: true })
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
