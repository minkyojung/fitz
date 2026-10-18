// Talk to the translation agent from a terminal, through the same /live socket and the same fold the page uses.
// usage: node server/agent/chat.mjs [--port 4800] [--model claude-opus-5-5] [--effort medium]
//        node server/agent/chat.mjs --list            the kept conversations, most recently used first
//        node server/agent/chat.mjs --open <id>       go on with one: what was said, then your next message
// Start the server first (node server/index.mjs). Type a message and Enter. When Claude wants to write, the change
// is shown and the next line answers it: y (allow), a (allow this kind of write for the rest of the conversation),
// n (decline). Ctrl-C stops a turn that is going; Ctrl-C with nothing going quits.
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
const green = (s) => `\x1b[32m${s}\x1b[0m`
const bold = (s) => `\x1b[1m${s}\x1b[0m`
const out = (s) => process.stdout.write(s)

const reopen = arg("open")
const convId = reopen ?? randomUUID()
const ws = new WebSocket(`ws://localhost:${arg("port", 4800)}/live`)
let rl = null       // reading input starts once the socket is open
let state = emptyConversation()
let shown = 0       // characters of the block being written that are already on screen
let busy = false
let ending = false  // input is over: quit once the turn that is going ends
let asks = []       // writes waiting for an answer, oldest first; the next line answers the first
const ANSWERS = { y: "allow", yes: "allow", a: "always", always: "always", n: "deny", no: "deny" }
/** Ask for the next line, unless input is over (piped input ends before the answers come). */
const prompt = () => { if (!ending) rl?.prompt() }

function showAsk(ask) {
  const p = ask.preview
  out(`\n${bold(`Claude wants to: ${p.summary}`)}\n`)
  if (p.before) out(red(p.before.split("\n").map((l) => `- ${l}`).join("\n")) + "\n")
  out(green(p.after.split("\n").map((l) => `+ ${l}`).join("\n")) + "\n")
  rl?.setPrompt("allow? y / a (always, this conversation) / n › ")
  prompt()
}

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
      else prompt()
    }
  }
  // tool results
  for (const it of next.items) {
    const before = prev.items.find((p) => p.kind === "tool" && p.id === it.id)
    if (it.kind === "tool" && before?.status === "running" && it.status !== "running") out(toolResult(it) + "\n")
  }
}

/** A reopened conversation, as it was: the translator's messages, Claude's answers, its tool calls and turns. */
function replay(items) {
  for (const it of items) {
    if (it.kind === "user") out(`\n› ${it.text}\n`)
    else if (it.kind === "text") out(`\n${it.text}\n`)
    else if (it.kind === "thinking") out(dim(`\n(thinking) ${it.text}\n`))
    else if (it.kind === "tool") out(dim(`\n→ ${toolLine(it)}\n`) + toolResult(it) + "\n")
    else if (it.kind === "turn") out(dim(`\n— ${it.reason} · ${((it.ms ?? 0) / 1000).toFixed(1)}s · $${(it.cost ?? 0).toFixed(3)}\n`))
  }
}

ws.on("open", () => {
  if (process.argv.includes("--list")) return ws.send(JSON.stringify({ type: "list" }))
  if (reopen) ws.send(JSON.stringify({ type: "open", convId }))
  else ws.send(JSON.stringify({ type: "start", convId, ...(arg("model") && { model: arg("model") }), ...(arg("effort") && { effort: arg("effort") }) }))
  out(dim(reopen ? `fitz agent · conversation ${convId}\n` : `fitz agent · ${arg("model", "claude-opus-5-5")} · ask about the book, e.g. "¶36의 뉘앙스는?"  (this conversation: ${convId})\n`))
  listen()
})
ws.on("message", (raw) => {
  const event = JSON.parse(String(raw))
  if (event.type === "error") { out(red(`\n${event.message}\n`)); if (busy && !state.live) { busy = false; prompt() } return }
  if (event.type === "ask") { asks.push(event.ask); if (asks.length === 1) showAsk(event.ask); return }
  if (event.type === "asked") {
    asks = asks.filter((a) => a.requestId !== event.requestId)
    out(dim(`  (${event.decision === "cancelled" ? "not answered: the turn stopped" : event.decision === "deny" ? "declined" : "allowed"})\n`))
    if (asks.length) showAsk(asks[0])
    else rl?.setPrompt("\n› ")
    return
  }
  if (event.type === "conversations") {
    for (const c of event.items) out(`${c.id}  ${c.usedAt}  ${c.model}  ${c.title ?? dim("(no title yet)")}\n`)
    if (!event.items.length) out(dim("no conversations yet\n"))
    return ws.close()
  }
  if (event.type !== "snapshot" && event.type !== "message") return  // the book's changes and anything newer are not the conversation
  if (event.type === "snapshot" && reopen && !state.items.length) { replay(event.state.items); prompt() }
  if (event.type === "snapshot") { asks = event.asks ?? []; if (asks.length) showAsk(asks[0]) }
  const prev = state
  state = event.type === "snapshot" ? event.state : applyMessage(state, event.message)
  if (event.type === "message") show(prev, state)
})
ws.on("error", (e) => { console.error(red(`cannot reach the agent: ${e.message} (is node server/index.mjs running?)`)); process.exit(1) })
ws.on("close", () => { out(dim("\nconnection closed\n")); process.exit(0) })

function listen() {
  rl = createInterface({ input: process.stdin, output: process.stdout, prompt: "\n› " })
  rl.on("line", (line) => {
    if (asks.length) {
      const decision = ANSWERS[line.trim().toLowerCase()]
      if (!decision) return showAsk(asks[0])
      return ws.send(JSON.stringify({ type: "answer", convId, requestId: asks[0].requestId, decision }))
    }
    if (!line.trim()) return prompt()
    busy = true
    ws.send(JSON.stringify({ type: "send", convId, text: line }))
  })
  rl.on("SIGINT", () => {
    if (busy) { out(dim("\n(stopping)\n")); ws.send(JSON.stringify({ type: "stop", convId })) }
    else rl.close()
  })
  rl.on("close", () => { ending = true; if (!busy) ws.close() })
  prompt()
}
