import assert from "node:assert/strict"
import { createServer } from "node:http"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import { DatabaseSync } from "node:sqlite"

import WebSocket from "ws"

import { foldMessages } from "./fold.mjs"
import { createAgentHost } from "./host.mjs"
import { attachAgentSocket, localOrigin } from "./socket.mjs"
import { settle, stubSessions } from "./fixtures/stubSession.mjs"

const nuance = readFileSync(new URL("./fixtures/nuance.jsonl", import.meta.url), "utf8").trim().split("\n").map((l) => JSON.parse(l))
const ID = "0b6f3f2e-6a3c-4d0e-9d55-6a1c2f0e9b11"

async function serve(t, db = {}) {
  const stubs = stubSessions()
  const server = createServer()
  attachAgentSocket(server, createAgentHost({ db, openSession: stubs.openSession }))
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  const clients = []
  // the server closes only once its connections are gone: end them first, in one place
  t.after(() => { for (const ws of clients) ws.terminate(); return new Promise((resolve) => server.close(resolve)) })
  return { ...stubs, clients, url: `ws://127.0.0.1:${server.address().port}/agent` }
}

async function connect({ url, clients }, options) {
  const ws = new WebSocket(url, options)
  clients.push(ws)
  const received = []
  ws.on("message", (raw) => received.push(JSON.parse(String(raw))))
  await new Promise((resolve, reject) => { ws.once("open", resolve); ws.once("error", reject) })
  const until = async (pred) => { for (let i = 0; i < 200 && !pred(received); i++) await new Promise((r) => setTimeout(r, 5)) }
  return { ws, received, until, say: (m) => ws.send(JSON.stringify(m)) }
}

test("over the socket: start, send, and the conversation arrives as a snapshot and messages", async (t) => {
  const srv = await serve(t)
  const { opened } = srv
  const page = await connect(srv)
  page.say({ type: "start", convId: ID })
  page.say({ type: "send", convId: ID, text: "¶4는?" })
  await page.until(() => opened.length === 1 && opened[0].sent.length === 1)
  assert.deepEqual(opened[0].sent, ["¶4는?"])
  opened[0].feed(...nuance)
  await settle()
  await page.until((r) => r.length === nuance.length + 1)
  const [snapshot, ...rest] = page.received
  assert.equal(snapshot.type, "snapshot")
  assert.deepEqual(foldMessages(rest.map((e) => e.message), snapshot.state), JSON.parse(JSON.stringify(foldMessages(nuance))))
})

test("a second page opens the same conversation mid-way and ends in the same state", async (t) => {
  const srv = await serve(t)
  const { opened } = srv
  const a = await connect(srv)
  a.say({ type: "start", convId: ID })
  a.say({ type: "send", convId: ID, text: "q" })
  await a.until(() => opened.length === 1)
  opened[0].feed(...nuance.slice(0, 50))
  await settle()
  const b = await connect(srv)
  b.say({ type: "open", convId: ID })
  await b.until((r) => r.length === 1)
  opened[0].feed(...nuance.slice(50))
  await settle()
  await b.until((r) => r.length === nuance.length - 50 + 1)
  const [snapshot, ...rest] = b.received
  assert.deepEqual(foldMessages(rest.map((e) => e.message), snapshot.state), JSON.parse(JSON.stringify(foldMessages(nuance))))
})

test("a malformed or refused message gets an error, and the socket stays open", async (t) => {
  const srv = await serve(t)
  const page = await connect(srv)
  page.ws.send("{")
  page.say({ type: "send", convId: ID, text: "q" })
  page.say({ type: "start", convId: ID })
  page.say({ type: "start", convId: ID })
  await page.until((r) => r.length === 4)
  assert.deepEqual(page.received.map((e) => e.type), ["error", "error", "snapshot", "error"])
  assert.match(page.received[0].message, /not JSON/)
  assert.deepEqual(page.received[1], { type: "error", convId: ID, message: `no conversation ${ID}` })
  assert.deepEqual(page.received[3], { type: "error", convId: ID, message: `conversation ${ID} exists` })
  assert.equal(page.ws.readyState, WebSocket.OPEN)
})

test("a page from another site cannot connect; this machine's pages can", async (t) => {
  const srv = await serve(t)
  await assert.rejects(connect(srv, { origin: "https://evil.example" }), /401/)
  await connect(srv, { origin: "http://localhost:5173" })
  assert.equal(localOrigin("http://127.0.0.1:4173"), true)
  assert.equal(localOrigin("http://localhost.evil.example"), false)
  assert.equal(localOrigin("null"), false)
})

test("over the socket: a write is asked, and the page's answer reaches Claude Code", async (t) => {
  const book = new DatabaseSync(":memory:")
  book.exec(readFileSync(new URL("../../db/schema.sql", import.meta.url), "utf8"))
  book.exec(readFileSync(new URL("./fixtures/gatsby.sql", import.meta.url), "utf8"))
  const srv = await serve(t, book)
  const page = await connect(srv)
  page.say({ type: "start", convId: ID })
  page.say({ type: "send", convId: ID, text: "q" })
  await page.until(() => srv.opened.length === 1)
  const answered = srv.opened[0].options.ask("mcp__fitz__add_comment", { segmentId: 1, side: "source", body: "b" }, {})
  await page.until((r) => r.some((e) => e.type === "ask"))
  const { ask } = page.received.find((e) => e.type === "ask")
  page.say({ type: "answer", convId: ID, requestId: ask.requestId, decision: "deny" })
  assert.equal((await answered).behavior, "deny")
})
