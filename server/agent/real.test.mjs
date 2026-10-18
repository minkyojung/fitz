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
import { openSession } from "./session.mjs"

const REAL = process.env.FITZ_REAL_CLAUDE === "1"
const skip = !REAL && "set FITZ_REAL_CLAUDE=1 (pnpm test:real) to run against real Claude Code"

function gatsby() {
  const db = new DatabaseSync(":memory:")
  db.exec(readFileSync(new URL("../../db/schema.sql", import.meta.url), "utf8"))
  db.exec(readFileSync(new URL("./fixtures/gatsby.sql", import.meta.url), "utf8"))
  return db
}

/** One conversation against real Claude Code in a folder of its own, cleaned up after the test. */
function realConversation(t, db) {
  const work = mkdtempSync(join(tmpdir(), "fitz-real-"))
  const cwd = join(work, "cwd")
  mkdirSync(cwd)
  const projectDir = join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude"), "projects", realpathSync(cwd).replace(/[^A-Za-z0-9]/g, "-"))
  const host = createAgentHost({ db, openSession: (o) => openSession({ ...o, cwd }), sessionInfo: async () => null, keep: { save: () => false, restore: () => false } })
  const id = randomUUID()
  const seen = { sessionId: null, toolUses: [] }
  t.after(async () => {
    host.close()
    if (seen.sessionId) await deleteSession(seen.sessionId, { dir: cwd })
    try { rmdirSync(projectDir) } catch { /* never written */ }
    rmSync(work, { recursive: true, force: true })
  })
  host.start(id, { model: "claude-haiku-5-5", effort: "low" })
  /** Send, allow every write Claude asks for, and resolve with the turn's result. */
  const ask = (text) => new Promise((resolve) => {
    const stop = host.open(id, (e) => {
      if (e.type === "ask") host.answer(id, e.ask.requestId, "allow")
      if (e.type !== "message") return
      const m = e.message
      seen.sessionId ??= m.session_id ?? null
      if (m.type === "assistant") for (const b of m.message.content) if (b.type === "tool_use") seen.toolUses.push(b)
      if (m.type === "result") { stop(); resolve(m) }
    })
    host.send(id, text)
  })
  return { ask, seen }
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
