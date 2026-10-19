// The server as it runs (node index.mjs), on a scratch copy of the Gatsby book, answering real HTTP requests.
import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { request } from "node:http"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { before, after, test } from "node:test"
import { DatabaseSync } from "node:sqlite"

let port, child, work, dbPath

const freePort = () => new Promise((resolve) => { const s = createServer().listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => resolve(p)) }) })

before(async () => {
  work = mkdtempSync(join(tmpdir(), "fitz-index-"))
  dbPath = join(work, "book.db")
  const db = new DatabaseSync(dbPath)
  db.exec(readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8"))
  db.exec(readFileSync(new URL("./agent/fixtures/gatsby.sql", import.meta.url), "utf8"))
  db.close()
  port = await freePort()
  child = spawn(process.execPath, [new URL("./index.mjs", import.meta.url).pathname, "--db", dbPath, "--port", String(port), "--pages", work], { stdio: ["ignore", "pipe", "pipe"] })
  await new Promise((resolve, reject) => {
    child.stdout.on("data", (d) => { if (String(d).includes("api ")) resolve() })
    child.on("exit", (code) => reject(new Error(`server exited ${code}`)))
  })
})
after(() => { child?.kill(); rmSync(work, { recursive: true, force: true }) })

/** A raw request: any Host, any Origin, any content type — what a hostile page could make the browser send. */
const send = ({ method = "POST", path, host = `localhost:${port}`, origin, type = "application/json", body = "" }) =>
  new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, method, path, headers: { host, ...(origin && { origin }), "content-type": type } }, (res) => {
      let text = ""
      res.on("data", (c) => (text += c))
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, text }))
    })
    req.on("error", reject)
    req.end(body)
  })
const commentCount = () => { const db = new DatabaseSync(dbPath, { readOnly: true }); try { return db.prepare("SELECT count(*) n FROM comment").get().n } finally { db.close() } }

test("another site's simple POST is refused before anything is written", async () => {
  const before = commentCount()
  const r = await send({ path: "/api/deleteComment", origin: "https://evil.example", type: "text/plain", body: JSON.stringify({ id: 1 }) })
  assert.equal(r.status, 403)
  assert.equal(r.headers["access-control-allow-origin"], undefined)
  assert.equal(commentCount(), before)
})

test("another site cannot read the book, nor ask to (preflight)", async () => {
  assert.equal((await send({ path: "/api/listSegments", origin: "https://evil.example", body: JSON.stringify({ chapterId: 1 }) })).status, 403)
  assert.equal((await send({ method: "OPTIONS", path: "/api/listSegments", origin: "https://evil.example" })).status, 403)
})

test("a request under another name (DNS rebinding) is refused, even without an Origin", async () => {
  assert.equal((await send({ path: "/api/getBook", host: `evil.example:${port}` })).status, 403)
  assert.equal((await send({ method: "GET", path: "/pages/page-001.png", host: `evil.example:${port}` })).status, 403)
})

test("this machine's page is served, and CORS names its origin", async () => {
  const r = await send({ path: "/api/getBook", origin: "http://localhost:5173" })
  assert.equal(r.status, 200)
  assert.equal(JSON.parse(r.text).title, "The Great Gatsby")
  assert.equal(r.headers["access-control-allow-origin"], "http://localhost:5173")
  const pre = await send({ method: "OPTIONS", path: "/api/getBook", origin: "http://localhost:5173" })
  assert.equal(pre.status, 204)
  assert.equal(pre.headers["access-control-allow-origin"], "http://localhost:5173")
})

test("a local program without an Origin (the terminal chat, a script) is served, with no CORS", async () => {
  const r = await send({ path: "/api/getBook" })
  assert.equal(r.status, 200)
  assert.equal(r.headers["access-control-allow-origin"], undefined)
})

test("Claude's suggestions: listed by chapter, accepted by the translator, and taken back with undo", async () => {
  const db = new DatabaseSync(dbPath)
  try {
    db.prepare(`INSERT INTO agent_suggestion(id, conversation_id, task, segment_id, side, quote, replacement, why, base_version)
                VALUES (1, 'c', 'typos', 5, 'source', 'privy', 'privvy', '-', 1)`).run()
  } finally { db.close() }
  const api = async (name, body = {}) => { const r = await send({ path: `/api/${name}`, body: JSON.stringify(body) }); return { status: r.status, body: JSON.parse(r.text) } }
  assert.deepEqual((await api("listSuggestions", { chapterId: 1 })).body.map((s) => [s.id, s.status]), [[1, "open"]])
  const accepted = await api("decideSuggestion", { id: 1, decision: "accept" })
  assert.equal(accepted.status, 200)
  assert.equal(accepted.body.status, "accepted")
  const source = async () => (await api("listSegments", { chapterId: 1 })).body.find((s) => s.id === 5).sourceText
  assert.match(await source(), /I was privvy to/)
  assert.deepEqual((await api("listSuggestions", { chapterId: 1 })).body, [])
  assert.equal((await api("undo")).body.name, "decideSuggestion")
  assert.match(await source(), /I was privy to/)
  assert.deepEqual((await api("listSuggestions", { chapterId: 1 })).body.map((s) => s.id), [1])
  assert.equal((await api("decideSuggestion", { id: 1, decision: "maybe" })).status, 400)
})

test("Claude's changes are taken back from the conversation by their tool calls; ⌘Z (undo) leaves them", async () => {
  const api = async (name, body = {}) => { const r = await send({ path: `/api/${name}`, body: JSON.stringify(body) }); return { status: r.status, body: JSON.parse(r.text) } }
  const { execute, openDb } = await import("./commands.mjs")
  const db = openDb(dbPath)
  try { execute(db, "updateSegment", { id: 4, targetDoc: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Claude가 쓴 번역" }] }] } }, { actor: "agent", toolUseId: "toolu_index" }) } finally { db.close() }
  const target = async () => (await api("listSegments", { chapterId: 1 })).body.find((s) => s.id === 4).targetText

  assert.equal((await api("undo")).body, null, "nothing of the translator's to undo")
  assert.equal(await target(), "Claude가 쓴 번역")
  assert.deepEqual((await api("claudeChanges", { toolUseIds: ["toolu_index"] })).body.map((o) => o.undone), [false])
  assert.deepEqual((await api("undoClaude", { toolUseIds: ["toolu_index"] })).body.map((o) => o.actor), ["agent"])
  assert.equal(await target(), "")
  assert.deepEqual((await api("claudeChanges", { toolUseIds: ["toolu_index"] })).body.map((o) => o.undone), [true])
  assert.equal((await api("undoClaude", { toolUseIds: ["../../etc"] })).status, 400)
})

test("the page asks what the checks found in a conversation's turns", async () => {
  const api = async (name, body = {}) => { const r = await send({ path: `/api/${name}`, body: JSON.stringify(body) }); return { status: r.status, body: JSON.parse(r.text) } }
  const { recordTurn } = await import("./agent/records.mjs")
  const db = new DatabaseSync(dbPath)
  const sessionId = "6f1d3c2a-9b8e-4c7d-a6f5-e4d3c2b1a0f9"
  try { recordTurn(db, sessionId, "u1", { reason: "completed", isError: false, checks: { checked: [4], rounds: [[]] } }) } finally { db.close() }
  assert.deepEqual((await api("turnChecks", { sessionId })).body, [{ userUuid: "u1", checks: { checked: [4], rounds: [[]] } }])
  assert.equal((await api("turnChecks", { sessionId: "../x" })).status, 400)
})

test("Session over HTTP: today's cards, an answer graded, words picked, a challenge used and taken back with undo", async () => {
  const api = async (name, body = {}) => { const r = await send({ path: `/api/${name}`, body: JSON.stringify(body) }); return { status: r.status, body: JSON.parse(r.text) } }
  const { dayOf } = await import("./drill/schedule.mjs")
  const today = dayOf(new Date())
  const db = new DatabaseSync(dbPath)
  const KO4 = "아버지는 더 말이 없었지만, 우리는 말을 아끼면서도 잘 통했다."
  db.prepare("UPDATE segment SET target_doc = ?, target_text = ? WHERE id = 4").run(JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: KO4 }] }] }), KO4)
  db.prepare("INSERT INTO drill_run(id, slot, status) VALUES (1, ?, 'done')").run(today)
  const insert = db.prepare(`INSERT INTO drill_card(run_id, segment_id, kind, origin, written_by, quote, question, options, answer, proposal, why, base_version, due_on, made_on)
    VALUES (1, 4, ?, 'claude', 'agent', ?, '?', ?, ?, ?, 'why', 1, ?, ?)`)
  const card = Number(insert.run("meaning", "veteran bores", '["가","나","다","라"]', 2, null, today, today).lastInsertRowid)
  const ch = Number(insert.run("challenge", "잘 통했다", null, null, "유난히 잘 통했다", today, today).lastInsertRowid)
  db.close()

  const s = (await api("sessionToday")).body
  assert.deepEqual([s.today, s.cards.map((c) => c.id), s.challenges.map((c) => c.id), s.evening.running], [today, [card], [ch], false])
  assert.equal("answer" in s.cards[0], false, "the answer is not sent before the translator answers")
  const graded = await api("answerCard", { id: card, choice: 2 })
  assert.deepEqual([graded.status, graded.body.correct, graded.body.box], [200, true, 2])
  assert.equal((await api("answerCard", { id: card, choice: 2 })).status, 409)
  assert.equal((await api("pickWords", { segmentId: 4, quote: "curious natures", origin: "picked" })).status, 200)
  assert.equal((await api("pickWords", { segmentId: 4, quote: "boars", origin: "picked" })).status, 400)
  assert.equal((await api("moreToday", { kind: "cards" })).body.cards, 10)

  const target = async () => (await api("listSegments", { chapterId: 1 })).body.find((x) => x.id === 4).targetText
  assert.equal((await api("decideChallenge", { id: ch, decision: "change" })).status, 200)
  assert.equal(await target(), KO4.replace("잘 통했다", "유난히 잘 통했다"))
  await api("undo")
  assert.equal(await target(), KO4)
  assert.deepEqual((await api("sessionToday")).body.challenges.map((c) => c.id), [ch])
  assert.deepEqual((await api("decideChallenge", { id: ch, decision: "keep" })).body, { id: ch, status: "kept" })
  assert.equal((await api("setCardAside", { id: card, why: "known" })).status, 200)
})
