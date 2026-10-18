// Talk to the translation agent from a terminal, through the same /agent socket and the same fold the page uses.
// usage: node server/agent/chat.mjs [--port 4800] [--model claude-opus-5-5] [--effort medium]
// Start the server first (node server/index.mjs). Type a message and Enter. Ctrl-C stops a turn that is going;
// Ctrl-C with nothing going quits.
import { randomUUID } from "node:crypto"
import { createInterface } from "node:readline"

import WebSocket from "ws"

import { applyMessage, emptyConversation } from "./fold.mjs"

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? dflt : process.argv[i + 1]
}
const dim = (s) => `\x1b[2m${s}\x1b[0m`
const red = (s) => `\x1b[31m${s}\x1b[0m`
const out = (s) => process.stdout.write(s)

const convId = randomUUID()
const ws = new WebSocket(`ws://localhost:${arg("port", 4800)}/agent`)
let rl = null       // reading input starts once the socket is open
let state = emptyConversation()
let shown = 0       // characters of the block being written that are already on screen
let busy = false
let ending = false  // input is over: quit once the turn that is going ends

const toolLine = (t) => `${t.name} ${JSON.stringify(t.input)}`
const toolResult = (t) => (t.status === "error" ? red(`  ✗ ${t.result}`) : dim(`  ✓ ${t.result?.segments ? `${t.result.segments.length} paragraphs${t.result.next ? ", more to read" : ""}` : t.result?.terms ? `${t.result.terms.length} terms` : t.result?.hits ? `${t.result.hits.length} hits` : "done"}`))

function show(prev, next) {
  // the block being written: print what is new
  if (next.live && next.live.kind !== "tool") {
    if (!prev.live) { out(next.live.kind === "thinking" ? dim("\n(thinking) ") : "\n"); shown = 0 }
    const more = next.live.text.slice(shown)
    out(next.live.kind === "thinking" ? dim(more) : more)
    shown = next.live.text.length
  }
  // finished items
  for (const it of next.items.slice(prev.items.length)) {
    if (it.kind === "text" || it.kind === "thinking") {
      const streamed = prev.live?.kind === it.kind
      const rest = streamed ? it.text.slice(shown) : `\n${it.text}`
      out(it.kind === "thinking" ? dim(rest) : rest)
      out("\n")
      shown = 0
    } else if (it.kind === "tool") out(dim(`\n→ ${toolLine(it)}\n`))
    else if (it.kind === "turn") {
      out(dim(`\n— ${it.reason} · ${(it.ms / 1000).toFixed(1)}s · $${it.cost.toFixed(3)}\n`))
      busy = false
      if (ending) ws.close()
      else rl.prompt()
    }
  }
  // tool results
  for (const it of next.items) {
    const before = prev.items.find((p) => p.kind === "tool" && p.id === it.id)
    if (it.kind === "tool" && before?.status === "running" && it.status !== "running") out(toolResult(it) + "\n")
  }
}

ws.on("open", () => {
  ws.send(JSON.stringify({ type: "start", convId, ...(arg("model") && { model: arg("model") }), ...(arg("effort") && { effort: arg("effort") }) }))
  out(dim(`fitz agent · ${arg("model", "claude-opus-5-5")} · ask about the book, e.g. "¶36의 뉘앙스는?"\n`))
  listen()
})
ws.on("message", (raw) => {
  const event = JSON.parse(String(raw))
  if (event.type === "error") { out(red(`\n${event.message}\n`)); if (busy && !state.live) { busy = false; rl?.prompt() } return }
  const prev = state
  state = event.type === "snapshot" ? event.state : applyMessage(state, event.message)
  if (event.type === "message") show(prev, state)
})
ws.on("error", (e) => { console.error(red(`cannot reach the agent: ${e.message} (is node server/index.mjs running?)`)); process.exit(1) })
ws.on("close", () => { out(dim("\nconnection closed\n")); process.exit(0) })

function listen() {
  rl = createInterface({ input: process.stdin, output: process.stdout, prompt: "\n› " })
  rl.on("line", (line) => {
    if (!line.trim()) return rl.prompt()
    busy = true
    ws.send(JSON.stringify({ type: "send", convId, text: line }))
  })
  rl.on("SIGINT", () => {
    if (busy) { out(dim("\n(stopping)\n")); ws.send(JSON.stringify({ type: "stop", convId })) }
    else rl.close()
  })
  rl.on("close", () => { ending = true; if (!busy) ws.close() })
  rl.prompt()
}
