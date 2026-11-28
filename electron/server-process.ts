// The server as the shell runs it: one child process — this same Electron binary run as plain Node, so the app
// does not depend on whatever node the machine has — told its settings over the IPC channel (shared/shellChannel.ts).
// A server that stops unasked has crashed, and that is the caller's to hear (`onCrash`).
import { spawn, type ChildProcess } from "node:child_process"

import { PROTOCOL_VERSION } from "../shared/protocol.ts"
import { ToShell, type ServerConfig, type ToServer } from "../shared/shellChannel.ts"

/** How many of the server's lines are kept to say why it stopped: the first few (what went wrong) and the last. */
const KEPT = 12
const FIRST = 3
/** Asked to stop, the server has this long before it is killed: a quit that hangs is worse than a hard stop. */
const GRACE_MS = 5000

export interface RunningServer {
  pid: number
  port: number
  /** The page's address. */
  url: string
  /** The address to open first: it carries the token once (server/http.ts). */
  door: string
}

export function createServerProcess({ entry, config, onCrash }: {
  /** The server's entry file. */
  entry: string
  config: ServerConfig
  /** A started server ended without being asked to. `words` is what it last said. */
  onCrash: (words: string[]) => void
}) {
  let child: ChildProcess | null = null
  let stopping = false
  /** The port the server had, asked for again after a crash so the page finds it where it was. */
  let port = config.port

  function start(): Promise<RunningServer> {
    stopping = false
    const words: string[] = []
    const said = (text: string) => {
      words.push(...text.split("\n").filter(Boolean))
      if (words.length > KEPT) words.splice(FIRST, words.length - KEPT, "…")
    }
    const c = spawn(process.execPath, [entry], { env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" }, stdio: ["ignore", "pipe", "pipe", "ipc"] })
    child = c
    c.stdout?.on("data", (d) => process.stdout.write(`[server] ${d}`))
    c.stderr?.on("data", (d) => {
      process.stderr.write(`[server] ${d}`)
      said(String(d))
    })
    return new Promise((resolve, reject) => {
      let ready = false
      // a failed spawn emits 'error', not 'exit'
      c.once("error", (e) => reject(new Error(`could not start the server: ${e.message}`)))
      c.once("exit", (code, signal) => {
        if (child === c) child = null
        if (!ready) reject(new Error(words.join("\n") || `the server ended (${code ?? signal}) before it was ready`))
        else if (!stopping) onCrash(words.length ? words : [`the server ended (${code ?? signal})`])
      })
      c.once("message", (message) => {
        const told = ToShell.safeParse(message)
        if (!told.success || told.data.ready.protocol !== PROTOCOL_VERSION) {
          c.kill()
          return reject(new Error(`the server is not of this app's protocol ${PROTOCOL_VERSION}: ${JSON.stringify(message)}`))
        }
        ready = true
        port = told.data.ready.port
        const url = `http://127.0.0.1:${port}/`
        resolve({ pid: c.pid ?? 0, port, url, door: `${url}?token=${config.token}` })
      })
      c.send({ start: { ...config, port } } satisfies ToServer)
    })
  }

  /** Ask the server to stop, and insist after GRACE_MS. Resolves once it is gone. */
  async function stop(): Promise<void> {
    stopping = true
    const c = child
    if (!c || c.pid === undefined || c.exitCode !== null || c.signalCode !== null) return
    const gone = new Promise((done) => c.once("exit", done))
    c.kill("SIGTERM")
    const hard = setTimeout(() => c.kill("SIGKILL"), GRACE_MS)
    await gone
    clearTimeout(hard)
  }

  return { start, stop }
}
