// The server process. The shell starts it (Electron's own binary run as Node) with an IPC channel and tells it
// its settings in the first message; it opens the book, listens, and says ready with its port.
// Run by hand (no channel) it takes its settings from the environment and prints its address — for development.
//
// It stops when asked (SIGTERM, SIGINT) and when the shell goes away (the channel closes): a server must not
// outlive the app that started it.
import { randomBytes, randomUUID } from "node:crypto"
import type { AddressInfo } from "node:net"
import { join, resolve } from "node:path"

import { z } from "zod"

import { PROTOCOL_VERSION } from "../shared/protocol.ts"
import { ServerConfig, ToServer, type ToShell } from "../shared/shellChannel.ts"
import { openBook } from "./book.ts"
import { createBookServer } from "./http.ts"

/** How long open connections are given to end before the process leaves anyway. */
const GRACE_MS = 3000

const die = (message: string): never => {
  console.error(message)
  process.exit(1)
}

/** Open the book and listen. Returns what stops it. A book that cannot be opened, or a port that cannot be had, ends the process. */
function start(config: ServerConfig, listening: (port: number) => void): () => void {
  let book: ReturnType<typeof openBook>
  try {
    book = openBook(config.dbPath)
  } catch (e) {
    return die(e instanceof Error ? e.message : String(e))
  }
  const server = createBookServer({ book, token: config.token, clientDir: config.clientDir, bootId: randomUUID() })
  server.on("error", (e) => die(`could not listen on 127.0.0.1:${config.port}: ${e.message}`))
  server.listen(config.port, "127.0.0.1", () => listening((server.address() as AddressInfo).port))

  let stopping = false
  return () => {
    if (stopping) return
    stopping = true
    server.close(() => {
      book.close()
      process.exit(0)
    })
    server.closeAllConnections()
    setTimeout(() => process.exit(0), GRACE_MS).unref()
  }
}

let stop = (): void => process.exit(0)
process.on("SIGTERM", () => stop())
process.on("SIGINT", () => stop())

if (process.send) {
  const tellShell = (message: ToShell) => process.send?.(message)
  process.on("disconnect", () => stop())
  process.once("message", (first) => {
    const told = ToServer.safeParse(first)
    if (!told.success) return die(`the shell's first message is not a start:\n${z.prettifyError(told.error)}`)
    stop = start(told.data.start, (port) => tellShell({ ready: { port, protocol: PROTOCOL_VERSION } }))
  })
} else {
  const root = resolve(import.meta.dirname, "..")
  const config = ServerConfig.safeParse({
    port: Number(process.env.FITZ_PORT ?? 0),
    token: randomBytes(32).toString("base64url"),
    dbPath: process.env.FITZ_DB ?? join(root, "dev-data/out/book.db"),
    clientDir: process.env.FITZ_CLIENT_DIR ?? join(root, "app/dist"),
  })
  if (!config.success) die(`the settings in the environment are not usable:\n${z.prettifyError(config.error)}`)
  else stop = start(config.data, (port) => console.log(`fitz server ready: http://127.0.0.1:${port}/?token=${config.data.token}`))
}
