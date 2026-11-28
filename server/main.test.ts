// The server as the shell runs it: a real child process, told its settings over the IPC channel, stopped by a
// signal or by the shell going away. Run with the same binary as the tests (node, or Electron as node).
import assert from "node:assert/strict"
import { spawn, type ChildProcess } from "node:child_process"
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { after, before, describe, test } from "node:test"

import { PROTOCOL_VERSION } from "../shared/protocol.ts"
import { ToShell, type ServerConfig } from "../shared/shellChannel.ts"
import { LATEST } from "./migrate.ts"
import { PAGES, bookCopy } from "./testing.ts"

const ROOT = resolve(import.meta.dirname, "..")
const MAIN = join(ROOT, "server/main.ts")
const TOKEN = "s".repeat(48)

describe("the server as a process", () => {
  let dir: string
  let COPY: string
  let backupDir: string
  const config = (more: Partial<ServerConfig> = {}): ServerConfig => ({ port: 0, token: TOKEN, dbPath: COPY, backupDir, pagesDir: PAGES, clientDir: join(ROOT, "app/dist"), ...more })
  const started: ChildProcess[] = []
  before(async () => {
    dir = mkdtempSync(join(tmpdir(), "fitz-main-"))
    ;({ path: COPY, backupDir } = await bookCopy(join(dir, "book"), "migrated"))
  })
  after(() => {
    for (const child of started) if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL")
    if (dir) rmSync(dir, { recursive: true, force: true })
  })

  /** The server started; `output` gathers what it prints. With `ipc` it waits to be told its settings. */
  const run = ({ ipc = true, env = {} }: { ipc?: boolean; env?: Record<string, string> } = {}) => {
    const child = spawn(process.execPath, [MAIN], { env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe", ...(ipc ? ["ipc" as const] : [])] })
    started.push(child)
    const output = { out: "", err: "" }
    child.stdout?.on("data", (d) => { output.out += d })
    child.stderr?.on("data", (d) => { output.err += d })
    const exited = new Promise<number | null>((done) => child.once("exit", (code) => done(code)))
    return { child, output, exited }
  }
  const within = <T>(ms: number, what: string, promise: Promise<T>) =>
    Promise.race([promise, new Promise<never>((_, fail) => setTimeout(() => fail(new Error(`${what}: nothing within ${ms} ms`)), ms).unref())])
  const ready = (child: ChildProcess) =>
    within(10_000, "ready", new Promise<number>((done) => child.once("message", (m) => done(ToShell.parse(m).ready.port))))
  const hello = (port: number, token = TOKEN) =>
    fetch(`http://127.0.0.1:${port}/api/hello`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify({ protocol: PROTOCOL_VERSION }) })
  const refusesConnections = (port: number) => assert.rejects(fetch(`http://127.0.0.1:${port}/`), "nothing listens once the server has stopped")

  test("told its settings, it says ready with its port and answers there", async () => {
    const { child, output, exited } = run()
    child.send({ start: config() })
    const message = await within(10_000, "ready", new Promise((done) => child.once("message", done)))
    assert.deepEqual(Object.keys(ToShell.parse(message).ready).sort(), ["port", "protocol"])
    const { port, protocol } = ToShell.parse(message).ready
    assert.equal(protocol, PROTOCOL_VERSION)
    const reply = await hello(port)
    assert.equal(reply.status, 200)
    assert.equal((await reply.json()).revision, 0)
    assert.equal((await hello(port, "wrong")).status, 401)
    assert.ok(!child.spawnargs.join(" ").includes(TOKEN) && !output.out.includes(TOKEN) && !output.err.includes(TOKEN), "the token is in neither the arguments nor the output")
    child.kill("SIGTERM")
    assert.equal(await within(5000, "exit after SIGTERM", exited), 0)
    await refusesConnections(port)
  })

  test("each start has a boot id of its own", async () => {
    const ids: string[] = []
    for (let i = 0; i < 2; i++) {
      const { child, exited } = run()
      child.send({ start: config() })
      ids.push((await (await hello(await ready(child))).json()).bootId)
      child.kill("SIGTERM")
      await within(5000, "exit", exited)
    }
    assert.notEqual(ids[0], ids[1])
  })

  test("it stops when the shell goes away", async () => {
    const { child, exited } = run()
    child.send({ start: config() })
    const port = await ready(child)
    child.disconnect()
    assert.equal(await within(5000, "exit after the channel closed", exited), 0)
    await refusesConnections(port)
  })

  test("it stops when the shell is killed outright", async () => {
    // a stand-in shell: starts the server as the real one does, prints its pid and port, then is killed with no chance to clean up
    const shell = `
      import { spawn } from "node:child_process"
      const server = spawn(process.execPath, [${JSON.stringify(MAIN)}], { stdio: ["ignore", "ignore", "ignore", "ipc"] })
      server.send({ start: ${JSON.stringify(config())} })
      server.once("message", (m) => console.log(JSON.stringify({ pid: server.pid, port: m.ready.port })))
    `
    const parent = spawn(process.execPath, ["--input-type=module", "-e", shell], { stdio: ["ignore", "pipe", "inherit"] })
    started.push(parent)
    const { pid, port } = await within(10_000, "the stand-in shell", new Promise<{ pid: number; port: number }>((done) => {
      let out = ""
      parent.stdout?.on("data", (d) => { out += d; if (out.includes("\n")) done(JSON.parse(out)) })
    }))
    assert.equal((await hello(port)).status, 200)
    parent.kill("SIGKILL")
    const alive = () => { try { process.kill(pid, 0); return true } catch { return false } }
    await within(5000, "the server's exit", (async () => { while (alive()) await new Promise((r) => setTimeout(r, 25)) })())
    await refusesConnections(port)
  })

  test("it stops when the shell goes away before telling it anything", async () => {
    const { child, exited } = run()
    child.disconnect()
    assert.equal(await within(5000, "exit", exited), 0)
  })

  test("a book as the prototype left it is migrated before it is served, with a backup kept", async () => {
    const book = await bookCopy(join(dir, "prototype"), "prototype")
    const version = () => {
      const db = new DatabaseSync(book.path, { readOnly: true })
      try { return [Number(Object.values(db.prepare("PRAGMA user_version").get() ?? {})[0]), Object.values(db.prepare("PRAGMA journal_mode").get() ?? {})[0]] } finally { db.close() }
    }
    assert.deepEqual(version(), [0, "delete"])
    const { child, output, exited } = run()
    child.send({ start: config({ dbPath: book.path, backupDir: book.backupDir }) })
    const port = await ready(child)
    assert.equal((await hello(port)).status, 200)
    assert.deepEqual(version(), [LATEST, "wal"])
    assert.equal(readdirSync(book.backupDir).length, 1)
    assert.match(output.out, new RegExp(`book migrated from version 0 to ${LATEST}`))
    child.kill("SIGTERM")
    assert.equal(await within(5000, "exit", exited), 0)

    // started again on the same book: nothing to migrate, no second backup
    const again = run()
    again.child.send({ start: config({ dbPath: book.path, backupDir: book.backupDir }) })
    assert.equal((await hello(await ready(again.child))).status, 200)
    assert.equal(readdirSync(book.backupDir).length, 1)
    assert.ok(!again.output.out.includes("migrated"))
    again.child.kill("SIGTERM")
    await within(5000, "exit", again.exited)
  })

  test("a book from a newer fitz ends it, saying so, and the book is not touched", async () => {
    const book = await bookCopy(join(dir, "newer"), "migrated")
    const db = new DatabaseSync(book.path)
    db.exec(`PRAGMA user_version = ${LATEST + 1}`)
    db.close()
    const { child, output, exited } = run()
    child.send({ start: config({ dbPath: book.path, backupDir: book.backupDir }) })
    assert.equal(await within(5000, "exit", exited), 1)
    assert.match(output.err, /newer/)
    assert.equal(readdirSync(book.backupDir).length, 1, "only the backup from when the copy was made")
  })

  test("a database that is not there ends it, saying which", async () => {
    const missing = join(ROOT, "dev-data/no-such-book.db")
    const { child, output, exited } = run()
    child.send({ start: config({ dbPath: missing }) })
    assert.equal(await within(5000, "exit", exited), 1)
    assert.ok(output.err.includes(missing), output.err)
    assert.ok(!existsSync(missing))
  })

  test("settings that are not as the channel says end it", async () => {
    for (const first of [{ start: { ...config(), token: "short" } }, { start: { ...config(), extra: 1 } }, { begin: config() }, "start"]) {
      const { child, output, exited } = run()
      child.send(first)
      assert.equal(await within(5000, "exit", exited), 1, JSON.stringify(first))
      assert.match(output.err, /start/)
    }
  })

  test("a port already taken ends it, saying so", async () => {
    const taken = createServer()
    await new Promise<void>((done) => taken.listen(0, "127.0.0.1", done))
    const { port } = taken.address() as { port: number }
    try {
      const { child, output, exited } = run()
      child.send({ start: config({ port }) })
      assert.equal(await within(5000, "exit", exited), 1)
      assert.ok(output.err.includes(String(port)), output.err)
    } finally {
      await new Promise((done) => taken.close(done))
    }
  })

  test("run by hand, it takes its settings from the environment and prints where it is", async () => {
    const { child, output, exited } = run({ ipc: false, env: { FITZ_DB: COPY, FITZ_BACKUP_DIR: backupDir, FITZ_PORT: "0" } })
    const line = await within(10_000, "the address line", new Promise<string>((done) => {
      const look = () => { const m = /http:\/\/127\.0\.0\.1:\d+\/\?token=\S+/.exec(output.out); if (m) done(m[0]) }
      child.stdout?.on("data", look)
      look()
    }))
    const url = new URL(line)
    const token = url.searchParams.get("token") ?? ""
    assert.ok(token.length >= 32)
    assert.equal((await hello(Number(url.port), token)).status, 200)
    const door = await fetch(line, { redirect: "manual" })
    assert.equal(door.status, 302)
    child.kill("SIGINT")
    assert.equal(await within(5000, "exit after SIGINT", exited), 0)
  })
})
