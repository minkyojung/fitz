// Records one real turn of the agent as JSONL: the fixture fold.mjs is tested against (docs/agent.md §11).
// usage: node server/agent/record.mjs --out <file.jsonl> --prompt "<what the translator asks>"
//          [--answer allow|always|deny] [--db out/book.db] [--model claude-opus-5-5] [--effort medium]
//        node server/agent/record.mjs --out <file.jsonl> --task review|typos [--chapter 1] [--db …] [--model …] [--effort …]
// It runs through host.mjs, as the server does; a write Claude asks for is answered with --answer (default deny).
// A task (tasks.mjs) is started on a chapter as the app starts it, with the task's model unless --model says
// otherwise; the suggestions kept from its answer are printed.
// Without --db the book is fixtures/gatsby.sql (public domain), so committed recordings never hold the book being
// translated; a task gets fixtures/gatsby-tasks.sql on top, OCR errors and translations to review planted in it.
// With --db the database is copied first, so even an allowed write never reaches the original.
// The session runs in a fresh temporary folder and is deleted afterwards. What Claude Code kept of it on disk
// (getSessionMessages) is written beside the recording as <out>.stored.json, for the stored-vs-live fold test.
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmdirSync, rmSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"

import { deleteSession, getSessionInfo, getSessionMessages } from "@anthropic-ai/claude-agent-sdk"

import { createAgentHost } from "./host.mjs"
import { openSession } from "./session.mjs"

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? dflt : process.argv[i + 1]
}
const out = arg("out")
const prompt = arg("prompt")
const task = arg("task")
const answer = arg("answer", "deny")
if (!out || !prompt === !task) throw new Error("usage: record.mjs --out <file.jsonl> (--prompt <text> [--answer allow|always|deny] | --task review|typos [--chapter <id>]) [--db <book.db>] [--model <id>] [--effort <level>]")
const TIMEOUT_MS = 5 * 60_000

const work = mkdtempSync(join(tmpdir(), "fitz-record-"))
const db = (() => {
  if (arg("db")) {
    copyFileSync(arg("db"), join(work, "book.db"))
    return new DatabaseSync(join(work, "book.db"))
  }
  const mem = new DatabaseSync(":memory:")
  mem.exec(readFileSync(new URL("../../db/schema.sql", import.meta.url), "utf8"))
  mem.exec(readFileSync(new URL("./fixtures/gatsby.sql", import.meta.url), "utf8"))
  if (task) mem.exec(readFileSync(new URL("./fixtures/gatsby-tasks.sql", import.meta.url), "utf8"))
  return mem
})()
const cwd = join(work, "cwd")
mkdirSync(cwd)
// deleteSession removes the session file but leaves its (then empty) project folder; rmdirSync only removes it empty
const projectDir = join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude"), "projects", realpathSync(cwd).replace(/[^A-Za-z0-9]/g, "-"))

// the session is deleted afterwards, so nothing is copied for keeping
const host = createAgentHost({ db, openSession: (options) => openSession({ ...options, cwd }), sessionInfo: (id) => getSessionInfo(id, { dir: cwd }),
  keep: { save: () => false, restore: () => false, savedCost: () => 0 } })
const convId = "00000000-0000-4000-8000-000000000000"
const frames = []
const asks = []
const started = Date.now()
let sessionId = null
const result = await new Promise((resolve) => {
  if (task) host.start(convId, { task, chapterId: Number(arg("chapter", 1)), ...(arg("model") && { model: arg("model") }), ...(arg("effort") && { effort: arg("effort") }) })
  else host.start(convId, { model: arg("model", "claude-opus-5-5"), effort: arg("effort", "medium") })
  host.open(convId, (event) => {
    if (event.type === "ask") { asks.push(`${event.ask.preview.summary} → ${answer}`); host.answer(convId, event.ask.requestId, answer) }
    if (event.type !== "message") return
    frames.push({ ms: Date.now() - started, ...event.message })
    sessionId ??= event.message.session_id ?? null
    if (event.message.type === "result") resolve(event.message)
  })
  if (!task) host.send(convId, prompt)
  setTimeout(() => { console.error("timed out; stopping"); host.stop(convId) }, TIMEOUT_MS).unref()
})
await host.close()  // Claude Code writes to the session file on its way out: read and delete it only after
const suggestions = task ? db.prepare("SELECT segment_id, quote, replacement, level, why FROM agent_suggestion ORDER BY id").all().map((r) => ({ ...r })) : undefined

// the home folder becomes ~ so a committed recording names no one
const anon = (text) => text.replaceAll(homedir(), "~")
writeFileSync(out, anon(frames.map((f) => JSON.stringify(f)).join("\n") + "\n"))
if (sessionId) {
  const stored = await getSessionMessages(sessionId, { dir: cwd })
  writeFileSync(out.replace(/\.jsonl$/, ".stored.json"), anon(JSON.stringify(stored, null, 1) + "\n"))
  await deleteSession(sessionId, { dir: cwd })
  rmdirSync(projectDir)
}
rmSync(work, { recursive: true, force: true })

const counts = frames.reduce((c, f) => ({ ...c, [f.type + (f.subtype ? `/${f.subtype}` : "")]: (c[f.type + (f.subtype ? `/${f.subtype}` : "")] ?? 0) + 1 }), {})
console.log(JSON.stringify({
  out, frames: frames.length, counts, asks, suggestions,
  result: result && { subtype: result.subtype, isError: result.is_error, ms: result.duration_ms, turns: result.num_turns, costUsd: result.total_cost_usd },
  // prompt tokens per model request: what Claude Code put in front of the model each time
  requests: [...new Map(frames.filter((f) => f.type === "assistant").map((f) => [f.message.id, f.message.usage])).values()]
    .map((u) => u.input_tokens + u.cache_creation_input_tokens + u.cache_read_input_tokens),
  tools: frames.filter((f) => f.type === "assistant").flatMap((f) => f.message.content.filter((b) => b.type === "tool_use").map((b) => `${b.name} ${JSON.stringify(b.input)}`)),
}, null, 1))
