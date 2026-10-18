import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import { createServer } from "node:http"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import { DatabaseSync } from "node:sqlite"

import { execute, pmDoc, redo, undo, watchChanges } from "./commands.mjs"
import { serveChanges } from "./events.mjs"
import { setTranslation } from "./agent/tools.mjs"

const SCHEMA = readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8")
function fixture() {
  const db = new DatabaseSync(":memory:")
  db.exec(SCHEMA)
  db.exec(`
    INSERT INTO book(id, title, source_pdf) VALUES (1, 'T', 'x.pdf');
    INSERT INTO chapter(id, book_id, idx, title) VALUES (1, 1, 0, 'One');
    INSERT INTO segment(id, chapter_id, idx, page_start, page_end, source_doc, source_text) VALUES (1, 1, 0, 1, 1, '${pmDoc("alpha")}', 'alpha');
  `)
  return db
}
const translate = (db, text) => execute(db, "updateSegment", { id: 1, targetDoc: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] } })

test("a committed write is announced once, after it is in the database", () => {
  const db = fixture()
  const heard = []
  watchChanges(db, (c) => heard.push({ ...c, seen: db.prepare("SELECT target_text FROM segment WHERE id = 1").get().target_text }))
  translate(db, "알파")
  assert.deepEqual(heard, [{ opId: 1, name: "updateSegment", segmentIds: [1], kind: "do", seen: "알파" }])
})

test("the agent's writes are announced like the translator's", () => {
  const db = fixture()
  const heard = []
  watchChanges(db, (c) => heard.push(c))
  setTranslation(db, { segmentId: 1, text: "알파", expectVersion: db.prepare("SELECT version FROM segment WHERE id = 1").get().version })
  assert.deepEqual(heard, [{ opId: 1, name: "updateSegment", segmentIds: [1], kind: "do" }])
})

test("a refused write announces nothing", () => {
  const db = fixture()
  const heard = []
  watchChanges(db, (c) => heard.push(c))
  assert.throws(() => execute(db, "updateSegment", { id: 1, text: "x", expectVersion: -1 }), { status: 409 })
  assert.throws(() => execute(db, "updateSegment", { id: 99, text: "x" }), { status: 404 })
  assert.deepEqual(heard, [])
})

test("undo and redo are announced as what they are", () => {
  const db = fixture()
  const heard = []
  translate(db, "알파")
  watchChanges(db, (c) => heard.push(c))
  undo(db)
  redo(db)
  assert.deepEqual(heard.map((c) => [c.kind, c.opId, c.name]), [["undo", 1, "updateSegment"], ["redo", 1, "updateSegment"]])
})

test("a watcher that fails does not undo or fail the write; one that stops watching hears nothing more", () => {
  const db = fixture()
  const heard = []
  const quiet = console.error
  console.error = () => {}
  try {
    watchChanges(db, () => { throw new Error("broken watcher") })
    const stop = watchChanges(db, (c) => heard.push(c.opId))
    translate(db, "하나")
    stop()
    translate(db, "둘")
  } finally { console.error = quiet }
  assert.equal(db.prepare("SELECT target_text FROM segment WHERE id = 1").get().target_text, "둘")
  assert.deepEqual(heard, [1])
})

// --- the stream

function fakeExchange(origin) {
  const req = Object.assign(new EventEmitter(), { headers: origin ? { origin } : {} })
  const res = { status: null, headers: null, chunks: [], writeHead(s, h) { this.status = s; this.headers = h; return this }, write(c) { this.chunks.push(c) }, end() {} }
  return { req, res }
}

test("each change is an event; a closed stream stops listening", () => {
  const db = fixture()
  const { req, res } = fakeExchange("http://localhost:5173")
  serveChanges(db, req, res)
  assert.equal(res.status, 200)
  assert.equal(res.headers["content-type"], "text/event-stream")
  assert.equal(res.headers["access-control-allow-origin"], "http://localhost:5173")
  translate(db, "알파")
  assert.equal(res.chunks.at(-1), `event: change\ndata: {"opId":1,"name":"updateSegment","segmentIds":[1],"kind":"do"}\n\n`)
  req.emit("close")
  const written = res.chunks.length
  translate(db, "베타")
  assert.equal(res.chunks.length, written)
})

test("a page from another site may not follow the book", () => {
  const { req, res } = fakeExchange("https://evil.example")
  serveChanges(fixture(), req, res)
  assert.equal(res.status, 403)
})

test("over HTTP: an EventSource-style reader gets the change as it happens", async (t) => {
  const db = fixture()
  const server = createServer((req, res) => serveChanges(db, req, res))
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  const abort = new AbortController()
  t.after(() => { abort.abort(); return new Promise((resolve) => server.close(resolve)) })
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/events`, { signal: abort.signal, headers: { accept: "text/event-stream" } })
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let text = ""
  const until = async (pattern) => { while (!pattern.test(text)) text += decoder.decode((await reader.read()).value) }
  await until(/retry: 2000/)
  translate(db, "알파")
  await until(/event: change/)
  assert.match(text, /event: change\ndata: \{"opId":1,"name":"updateSegment","segmentIds":\[1\],"kind":"do"\}/)
})
