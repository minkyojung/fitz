// Records one real turn of the agent as JSONL: the fixture fold.mjs is tested against (docs/agent.md §11).
// usage: node server/agent/record.mjs --out <file.jsonl> --prompt "<what the translator asks>"
//          [--db out/book.db] [--model claude-opus-5-5] [--effort medium]
// Without --db the book is fixtures/gatsby.sql (public domain), so committed recordings never hold the book being
// translated. With --db the database is copied first; the agent only reads, but the original is never opened.
// The session runs in a fresh temporary folder and is deleted afterwards. What Claude Code kept of it on disk
// (getSessionMessages) is written beside the recording as <out>.stored.json, for the stored-vs-live fold test.
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmdirSync, rmSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"

import { deleteSession, getSessionMessages } from "@anthropic-ai/claude-agent-sdk"

import { openSession } from "./session.mjs"

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? dflt : process.argv[i + 1]
}
const out = arg("out")
const prompt = arg("prompt")
if (!out || !prompt) throw new Error("usage: record.mjs --out <file.jsonl> --prompt <text> [--db <book.db>] [--model <id>] [--effort <level>]")
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
  return mem
})()
const cwd = join(work, "cwd")
mkdirSync(cwd)
// deleteSession removes the session file but leaves its (then empty) project folder; rmdirSync only removes it empty
const projectDir = join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude"), "projects", realpathSync(cwd).replace(/[^A-Za-z0-9]/g, "-"))

const session = openSession({ db, cwd, model: arg("model", "claude-opus-5-5"), effort: arg("effort", "medium") })
const frames = []
const started = Date.now()
const timer = setTimeout(() => { console.error("timed out; interrupting"); session.interrupt() }, TIMEOUT_MS)
let sessionId = null
let result = null
session.send(prompt)
for await (const m of session.messages) {
  frames.push({ ms: Date.now() - started, ...m })
  sessionId ??= m.session_id ?? null
  if (m.type === "result") { result = m; break }
}
clearTimeout(timer)

// the home folder becomes ~ so a committed recording names no one
const anon = (text) => text.replaceAll(homedir(), "~")
writeFileSync(out, anon(frames.map((f) => JSON.stringify(f)).join("\n") + "\n"))
if (sessionId) {
  const stored = await getSessionMessages(sessionId, { dir: cwd })
  writeFileSync(out.replace(/\.jsonl$/, ".stored.json"), anon(JSON.stringify(stored, null, 1) + "\n"))
  session.close()
  await deleteSession(sessionId, { dir: cwd })
  rmdirSync(projectDir)
} else session.close()
rmSync(work, { recursive: true, force: true })

const counts = frames.reduce((c, f) => ({ ...c, [f.type + (f.subtype ? `/${f.subtype}` : "")]: (c[f.type + (f.subtype ? `/${f.subtype}` : "")] ?? 0) + 1 }), {})
console.log(JSON.stringify({
  out, frames: frames.length, counts,
  result: result && { subtype: result.subtype, isError: result.is_error, ms: result.duration_ms, turns: result.num_turns, costUsd: result.total_cost_usd },
  // prompt tokens per model request: what Claude Code put in front of the model each time
  requests: [...new Map(frames.filter((f) => f.type === "assistant").map((f) => [f.message.id, f.message.usage])).values()]
    .map((u) => u.input_tokens + u.cache_creation_input_tokens + u.cache_read_input_tokens),
  tools: frames.filter((f) => f.type === "assistant").flatMap((f) => f.message.content.filter((b) => b.type === "tool_use").map((b) => `${b.name} ${JSON.stringify(b.input)}`)),
}, null, 1))
