// Real Claude Code (Haiku), only when asked: FITZ_REAL_CLAUDE=1, or `pnpm test:real`. An evening run as the server
// makes it (runDrill, the drill task, the fitz read tools), on the Gatsby book in memory, in a fresh folder; Haiku
// instead of the drill's Opus, to spend little. The session is deleted afterwards.
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmdirSync, rmSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { DatabaseSync } from "node:sqlite"

import { deleteSession } from "@anthropic-ai/claude-agent-sdk"

import { openSession } from "../agent/session.mjs"
import { execute, findOnce } from "../commands.mjs"
import { runDrill } from "./evening.mjs"

const REAL = process.env.FITZ_REAL_CLAUDE === "1"
const skip = !REAL && "set FITZ_REAL_CLAUDE=1 (pnpm test:real) to run against real Claude Code"
const doc = (text) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] })

test("an evening run makes cards whose words are in the paragraphs, with four options and a challenge's words in the translation", { skip }, async (t) => {
  const db = new DatabaseSync(":memory:")
  db.exec(readFileSync(new URL("../../db/schema.sql", import.meta.url), "utf8"))
  db.exec(readFileSync(new URL("../agent/fixtures/gatsby.sql", import.meta.url), "utf8"))
  execute(db, "updateSegment", { id: 4, targetDoc: doc("아버지는 더 말이 없었지만, 우리는 말을 아끼면서도 잘 통했고, 나는 그 말에 훨씬 많은 뜻이 담겨 있음을 알았다. 그래서 나는 모든 판단을 서둘러 내리는 버릇이 생겼는데, 덕분에 별난 사람들이 내게 마음을 열었고, 지겨운 사람들에게 시달리기도 했다.") })
  execute(db, "updateSegment", { id: 5, targetDoc: doc("비정상적인 사람일수록 평범한 사람의 이런 기질을 금세 알아보고 들러붙는 법이라, 대학 시절 나는 정치꾼이라는 억울한 소리를 들었다. 거칠고 이름 없는 사내들의 남모를 슬픔을 내가 알고 있었기 때문이다.") }, { actor: "agent" })
  const work = mkdtempSync(join(tmpdir(), "fitz-real-drill-"))
  const cwd = join(work, "cwd")
  mkdirSync(cwd)
  const projectDir = join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude"), "projects", realpathSync(cwd).replace(/[^A-Za-z0-9]/g, "-"))
  let sessionId = null
  t.after(async () => {
    if (sessionId) await deleteSession(sessionId, { dir: cwd })
    try { rmdirSync(projectDir) } catch {}
    rmSync(work, { recursive: true, force: true })
  })

  const run = await runDrill(db, { slot: "2026-10-19", today: "2026-10-19", openSession: (o) => openSession({ ...o, cwd, model: "claude-haiku-5-5", effort: "low" }) })
  sessionId = run.session_id ?? null
  t.diagnostic(`run: ${JSON.stringify(run)}`)
  assert.equal(run.status, "done", run.error)
  assert.ok(run.made > 0, "some cards were kept")
  const cards = db.prepare("SELECT c.*, s.source_text, s.target_text FROM drill_card c JOIN segment s ON s.id = c.segment_id").all()
  for (const c of cards) {
    assert.ok([4, 5].includes(c.segment_id))
    if (c.kind === "challenge") assert.notEqual(findOnce(c.target_text, c.quote), -1)
    else {
      assert.notEqual(findOnce(c.source_text, c.quote), -1)
      assert.equal(JSON.parse(c.options).length, 4)
    }
  }
  assert.deepEqual(db.prepare("SELECT DISTINCT written_by FROM drill_card WHERE segment_id = 5").all().map((r) => r.written_by).filter(Boolean), cards.some((c) => c.segment_id === 5) ? ["agent"] : [])
})
