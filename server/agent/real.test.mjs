// Real Claude Code (Haiku), only when asked: FITZ_REAL_CLAUDE=1, or `pnpm test:real`. It spends a little usage and
// needs the Claude login (or ANTHROPIC_API_KEY); `pnpm test` skips it. It runs through host.mjs and the fitz tools
// as the server does, on the Gatsby book in memory, in a fresh folder. The session is deleted afterwards and no copy
// is kept: neither book.db nor the home folder keeps anything of it.
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmdirSync, rmSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { DatabaseSync } from "node:sqlite"

import { deleteSession } from "@anthropic-ai/claude-agent-sdk"

import { createAgentHost } from "./host.mjs"
import { DEFAULTS, READ_TOOLS, closeWarming, openSession, startWarming, warmthSoFar } from "./session.mjs"

const REAL = process.env.FITZ_REAL_CLAUDE === "1"
const skip = !REAL && "set FITZ_REAL_CLAUDE=1 (pnpm test:real) to run against real Claude Code"

function gatsby() {
  const db = new DatabaseSync(":memory:")
  db.exec(readFileSync(new URL("../../db/schema.sql", import.meta.url), "utf8"))
  db.exec(readFileSync(new URL("./fixtures/gatsby.sql", import.meta.url), "utf8"))
  return db
}

/** One conversation against real Claude Code in a folder of its own, cleaned up after the test. A task (`start`
 *  with task and chapterId) sets to work as soon as it starts. */
function realConversation(t, db, start = { model: "claude-haiku-5-5", effort: "low" }, { ahead = false } = {}) {
  const work = mkdtempSync(join(tmpdir(), "fitz-real-"))
  const cwd = join(work, "cwd")
  mkdirSync(cwd)
  // one Claude Code started ahead for this folder (docs/agent.md §30), as the server does for its own
  if (ahead) { startWarming(db, { cwd }); t.after(closeWarming) }
  const projectDir = join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude"), "projects", realpathSync(cwd).replace(/[^A-Za-z0-9]/g, "-"))
  const host = createAgentHost({ db, openSession: (o) => openSession({ ...o, cwd }), sessionInfo: async () => null, keep: { save: () => false, restore: () => false, savedCost: () => 0 } })
  const id = randomUUID()
  const seen = { sessionId: null, init: null, toolUses: [], asks: [] }
  t.after(async () => {
    await host.close()  // Claude Code writes to the session file on its way out: delete it only after
    if (seen.sessionId) await deleteSession(seen.sessionId, { dir: cwd })
    try { rmdirSync(projectDir) } catch { /* never written */ }
    rmSync(work, { recursive: true, force: true })
  })
  host.start(id, start)
  /** Allow every write Claude asks for, and resolve with the turn's result. */
  const result = () => new Promise((resolve) => {
    const stop = host.open(id, (e) => {
      if (e.type === "ask") { seen.asks.push(e.ask.tool); host.answer(id, e.ask.requestId, "allow") }
      if (e.type !== "message") return
      const m = e.message
      seen.sessionId ??= m.session_id ?? null
      if (m.type === "system" && m.subtype === "init") seen.init = m
      if (m.type === "assistant") { seen.model = m.message.model; for (const b of m.message.content) if (b.type === "tool_use") seen.toolUses.push(b) }
      if (m.type === "result") { stop(); resolve(m) }
    })
  })
  const ask = (text) => { const r = result(); host.send(id, text); return r }
  return { ask, result, seen }
}

test("Claude's write is recorded as the agent's, with the id of the very tool call that made it", { skip, timeout: 240_000 }, async (t) => {
  const db = gatsby()
  const { ask, seen } = realConversation(t, db)
  const result = await ask("Use the add_comment tool exactly once: on ¶4, side source, body 말장난 확인. Do nothing else and do not read anything.")
  assert.equal(result.subtype, "success", JSON.stringify(result))

  const call = seen.toolUses.find((b) => b.name === "mcp__fitz__add_comment")
  assert.ok(call, `Claude called: ${seen.toolUses.map((b) => b.name).join(", ") || "nothing"}`)
  const ops = db.prepare("SELECT name, actor, tool_use_id FROM ops ORDER BY id").all().map((r) => ({ ...r }))
  assert.deepEqual(ops, [{ name: "addComment", actor: "agent", tool_use_id: call.id }])
  const comment = { ...db.prepare("SELECT author, body FROM comment WHERE segment_id = 4 ORDER BY id DESC LIMIT 1").get() }
  assert.equal(comment.author, "agent")
  assert.match(comment.body, /말장난 확인/)
})

test("Claude searches the web without asking the translator", { skip, timeout: 240_000 }, async (t) => {
  const { ask, seen } = realConversation(t, gatsby())
  const result = await ask("Use WebSearch exactly once to find the year The Great Gatsby was first published, then answer with the year only. Do not read the book.")
  assert.equal(result.subtype, "success", JSON.stringify(result))
  assert.ok(seen.init.tools.includes("WebSearch"), seen.init.tools.join(", "))
  assert.ok(seen.toolUses.some((b) => b.name === "WebSearch"), `Claude called: ${seen.toolUses.map((b) => b.name).join(", ") || "nothing"}`)
  assert.deepEqual(seen.asks, [])
  assert.match(result.result, /1925/)
})

test("an OCR-error hunt answers in the agreed shape, offered only the read tools, and what it found is kept", { skip, timeout: 240_000 }, async (t) => {
  const db = gatsby()
  db.exec(readFileSync(new URL("./fixtures/gatsby-tasks.sql", import.meta.url), "utf8"))
  const { result, seen } = realConversation(t, db, { task: "typos", chapterId: 1, model: "claude-haiku-5-5", effort: "low" })
  const r = await result()
  assert.equal(r.subtype, "success", JSON.stringify(r))
  assert.deepEqual([...seen.init.tools].sort(), [...READ_TOOLS, "StructuredOutput"].sort())
  const kept = db.prepare("SELECT quote FROM agent_suggestion WHERE task = 'typos' AND side = 'source'").all().map((s) => s.quote)
  assert.ok(kept.length >= 1, `nothing kept of ${JSON.stringify(r.structured_output)}`)
  assert.equal(db.prepare("SELECT count(*) n FROM ops").get().n, 0, "finding changes nothing in the book")
})

test("a new conversation takes the Claude Code started ahead, switched to the model asked for before its first message", { skip, timeout: 240_000 }, async (t) => {
  const db = gatsby()
  assert.notEqual(DEFAULTS.model, "claude-haiku-5-5", "the one ahead has the defaults; this conversation asks for another")
  const { ask, seen } = realConversation(t, db, { model: "claude-haiku-5-5", effort: "low" }, { ahead: true })
  const result = await ask("안녕이라고만 답해.")
  assert.equal(result.subtype, "success", JSON.stringify(result))
  assert.deepEqual(warmthSoFar(), { taken: 1, cold: 0 })
  assert.equal(seen.model, "claude-haiku-5-5", "answered by the model asked for, not the one ahead's")
})
