// The server process. The shell starts it (Electron's own binary run as Node) with an IPC channel and tells it
// its settings in the first message; it opens the book, listens, and says ready with its port.
// Run by hand (no channel) it takes its settings from the environment and prints its address — for development.
//
// It stops when asked (SIGTERM, SIGINT) and when the shell goes away (the channel closes): a server must not
// outlive the app that started it.
import { randomBytes, randomUUID } from "node:crypto"
import type { AddressInfo } from "node:net"
import { dirname, join, resolve } from "node:path"

import { z } from "zod"

import { PROTOCOL_VERSION } from "../shared/protocol.ts"
import { ServerConfig, ToServer, type ToShell } from "../shared/shellChannel.ts"
import { openBook } from "./book.ts"
import { openWriter } from "./commands.ts"
import { createBookServer } from "./http.ts"
import { migrate } from "./migrate.ts"

/** How long open connections are given to end before the process leaves anyway. */
const GRACE_MS = 3000

const die = (message: string): never => {
  console.error(message)
  process.exit(1)
}

/** Bring the book to this app's version, open it and listen. Returns what stops it. A book that cannot be migrated or
 *  opened, or a port that cannot be had, ends the process — the book left as it was found. */
async function start(config: ServerConfig, listening: (port: number) => void): Promise<() => void> {
  let book: ReturnType<typeof openBook>
  let writer: ReturnType<typeof openWriter>
  try {
    const moved = await migrate(config.dbPath, { backupDir: config.backupDir })
    if (moved.backup) console.log(`book migrated from version ${moved.from} to ${moved.to}; what it was is kept at ${moved.backup}`)
    // two connections: every change goes through the writer; the reader's cannot write
    writer = openWriter(config.dbPath)
    book = openBook(config.dbPath)
  } catch (e) {
    return die(e instanceof Error ? e.message : String(e))
  }
  const server = createBookServer({ book, writer, pagesDir: config.pagesDir, token: config.token, clientDir: config.clientDir, bootId: randomUUID() })
  server.on("error", (e) => die(`could not listen on 127.0.0.1:${config.port}: ${e.message}`))
  server.listen(config.port, "127.0.0.1", () => listening((server.address() as AddressInfo).port))

  let stopping = false
  return () => {
    if (stopping) return
    stopping = true
    server.close(() => {
      book.close()
      writer.close()
      process.exit(0)
    })
    server.closeAllConnections()
    setTimeout(() => process.exit(0), GRACE_MS).unref()
  }
}

// Asked to stop with nothing begun, it leaves at once. Asked while the book is being migrated and opened, it leaves
// once that is done: a migration is never cut short.
let starting = false
let stopRequested = false
let stop = (): void => {
  if (starting) stopRequested = true
  else process.exit(0)
}
const begin = (config: ServerConfig, listening: (port: number) => void) => {
  starting = true
  void start(config, listening).then((stopper) => {
    stop = stopper
    if (stopRequested) stopper()
  })
}
process.on("SIGTERM", () => stop())
process.on("SIGINT", () => stop())

if (process.send) {
  const tellShell = (message: ToShell) => process.send?.(message)
  process.on("disconnect", () => stop())
  process.once("message", (first) => {
    const told = ToServer.safeParse(first)
    if (!told.success) return die(`the shell's first message is not a start:\n${z.prettifyError(told.error)}`)
    begin(told.data.start, (port) => tellShell({ ready: { port, protocol: PROTOCOL_VERSION } }))
  })
} else {
  const root = resolve(import.meta.dirname, "..")
  const dbPath = process.env.FITZ_DB ?? join(root, "dev-data/out/book.db")
  const config = ServerConfig.safeParse({
    port: Number(process.env.FITZ_PORT ?? 0),
    token: randomBytes(32).toString("base64url"),
    dbPath,
    backupDir: process.env.FITZ_BACKUP_DIR ?? join(dirname(dbPath), "backups"),
    pagesDir: process.env.FITZ_PAGES_DIR ?? join(dirname(dbPath), "pages"),
    clientDir: process.env.FITZ_CLIENT_DIR ?? join(root, "app/dist"),
  })
  if (!config.success) die(`the settings in the environment are not usable:\n${z.prettifyError(config.error)}`)
  else begin(config.data, (port) => console.log(`fitz server ready: http://127.0.0.1:${port}/?token=${config.data.token}`))
}
