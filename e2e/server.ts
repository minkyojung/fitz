// The real server for the browser tests: started as the shell starts it (settings over the IPC channel), serving
// the built page and a copy of the book made for this run. Tests that edit change that copy; every test compares
// the page with the same copy, read by plain SQL.
import { spawn } from "node:child_process"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { DatabaseSync } from "node:sqlite"

import { test as base, expect } from "@playwright/test"

import { bookCopy } from "../server/testing.ts"

const ROOT = resolve(import.meta.dirname, "..")
const CLIENT = join(ROOT, "app/dist")
const TOKEN = "e".repeat(48)

interface WorkerFixtures {
  /** The server's address, and the address the shell would open: it carries the token once. */
  server: { origin: string; door: string; sql: DatabaseSync }
  door: string
  /** The book the server serves, for counting what the page should show. */
  sql: DatabaseSync
  /** A request to the server from outside the page: another writer, as far as the page knows. */
  api: (name: string, params: unknown) => Promise<{ status: number; body: any }>
}
interface TestFixtures {
  /** What the browser complained of. A test that causes failures on purpose empties it before it ends. */
  complaints: string[]
}

export const test = base.extend<TestFixtures, WorkerFixtures>({
  server: [async ({}, use) => {
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
    const origin = `http://127.0.0.1:${port}`
    const sql = new DatabaseSync(book.path, { readOnly: true })
    await use({ origin, door: `${origin}/?token=${TOKEN}`, sql })
    sql.close()
    child.kill("SIGTERM")
    await new Promise((done) => child.once("exit", done))
    rmSync(dir, { recursive: true, force: true })
  }, { scope: "worker" }],

  door: [async ({ server }, use) => use(server.door), { scope: "worker" }],
  sql: [async ({ server }, use) => use(server.sql), { scope: "worker" }],
  api: [async ({ server }, use) => {
    await use(async (name, params) => {
      const res = await fetch(`${server.origin}/api/${name}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` }, body: JSON.stringify(params) })
      return { status: res.status, body: await res.json() }
    })
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
