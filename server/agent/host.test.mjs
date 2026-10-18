import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"

import { DatabaseSync } from "node:sqlite"

import { foldMessages } from "./fold.mjs"
import { DEFAULTS, createAgentHost } from "./host.mjs"
import { getConversation, listConversations, turnsOf } from "./records.mjs"
import { settle, stubSessions } from "./fixtures/stubSession.mjs"

const nuance = readFileSync(new URL("./fixtures/nuance.jsonl", import.meta.url), "utf8").trim().split("\n").map((l) => JSON.parse(l))
const ID = "0b6f3f2e-6a3c-4d0e-9d55-6a1c2f0e9b11"

function setup({ sessionInfo = async () => null } = {}) {
  const stubs = stubSessions()
  const db = gatsby()
  const host = createAgentHost({ db, openSession: stubs.openSession, sessionInfo })
  const events = []
  return { ...stubs, db, host, events, follow: (id = ID) => host.open(id, (e) => events.push(e)) }
}

test("Claude Code starts with the first message, once, with the conversation's model and the book", () => {
  const { host, opened, db } = setup()
  host.start(ID)
  assert.equal(opened.length, 0)
  host.send(ID, "¶4는?")
  host.send(ID, "그럼 ¶5는?")
  assert.equal(opened.length, 1)
  const { ask, ...options } = opened[0].options
  assert.deepEqual(options, { db, resume: undefined, model: DEFAULTS.model, effort: DEFAULTS.effort })
  assert.equal(typeof ask, "function")
  assert.deepEqual(opened[0].sent, ["¶4는?", "그럼 ¶5는?"])
  host.start("1b6f3f2e-6a3c-4d0e-9d55-6a1c2f0e9b11", { model: "claude-sonnet-5-5", effort: "low" })
  host.send("1b6f3f2e-6a3c-4d0e-9d55-6a1c2f0e9b11", "x")
  assert.deepEqual([opened[1].options.model, opened[1].options.effort], ["claude-sonnet-5-5", "low"])
})

test("a follower gets a snapshot, then every message; folding them ends where the host is", async () => {
  const { host, opened, events, follow } = setup()
  host.start(ID)
  host.send(ID, "q")
  opened[0].feed(...nuance.slice(0, 100))
  await settle()
  follow()  // joins mid-turn
  opened[0].feed(...nuance.slice(100))
  await settle()
  assert.equal(events[0].type, "snapshot")
  assert.deepEqual(events[0].state, foldMessages(nuance.slice(0, 100)))
  const rest = events.slice(1)
  assert.ok(rest.every((e) => e.type === "message" && e.convId === ID))
  assert.deepEqual(foldMessages(rest.map((e) => e.message), events[0].state), foldMessages(nuance))
})

test("stop interrupts the turn; stopping with nothing going is harmless", async () => {
  const { host, opened } = setup()
  host.start(ID)
  host.stop(ID)
  host.send(ID, "q")
  host.stop(ID)
  assert.equal(opened[0].interrupts, 1)
})

test("an unknown conversation, or one started twice, is refused", () => {
  const { host } = setup()
  assert.throws(() => host.send(ID, "q"), { status: 404 })
  assert.throws(() => host.open(ID, () => {}), { status: 404 })
  host.start(ID)
  assert.throws(() => host.start(ID), { status: 409 })
})

test("a process that dies mid-turn: followers hear why, the half-written turn is dropped, the next message resumes", async () => {
  const { host, opened, events, follow } = setup()
  host.start(ID)
  follow()
  host.send(ID, "q")
  const answerAt = nuance.findLastIndex((m) => m.type === "assistant")
  opened[0].feed(...nuance.slice(0, answerAt - 5))  // mid-answer
  await settle()
  opened[0].crash(new Error("exit code 1"))
  await settle()
  assert.deepEqual(events.at(-2), { type: "error", convId: ID, message: "Claude Code stopped: exit code 1" })
  const last = events.at(-1)
  assert.equal(last.type, "snapshot")
  assert.equal(last.state.status, "idle")
  assert.equal(last.state.live, null)
  host.send(ID, "again")
  assert.equal(opened.length, 2)
  assert.equal(opened[1].options.resume, nuance.find((m) => m.subtype === "init").session_id)
  assert.deepEqual(opened[1].sent, ["again"])
})

test("a follower that stops following hears nothing more; close ends every session", async () => {
  const { host, opened, events, follow } = setup()
  host.start(ID)
  const unfollow = follow()
  host.send(ID, "q")
  unfollow()
  opened[0].feed(nuance[0])
  await settle()
  assert.deepEqual(events.map((e) => e.type), ["snapshot"])
  host.close()
  assert.equal(opened[0].closed, true)
})

// --- writes put to the translator

function gatsby() {
  const book = new DatabaseSync(":memory:")
  book.exec(readFileSync(new URL("../../db/schema.sql", import.meta.url), "utf8"))
  book.exec(readFileSync(new URL("./fixtures/gatsby.sql", import.meta.url), "utf8"))
  return book
}
function asking() {
  const stubs = stubSessions()
  const host = createAgentHost({ db: gatsby(), openSession: stubs.openSession, sessionInfo: async () => null })
  const events = []
  host.start(ID)
  host.open(ID, (e) => events.push(e))
  host.send(ID, "¶3을 번역해 넣어줘")
  const write = { segmentId: 3, text: "“누군가를 비판하고 싶어질 때면 말이다.”", expectVersion: 3 }  // gatsby.sql's inserts numbered ¶1–5 as 1–5
  const claudeAsks = (input = write, signal) => stubs.opened[0].options.ask("mcp__fitz__set_translation", input, { signal })
  return { host, events, claudeAsks, write, ...stubs }
}

test("a write is put to the translator with what it would do, and allowed once", async () => {
  const { host, events, claudeAsks, write } = asking()
  const answered = claudeAsks()
  const asked = events.at(-1)
  assert.equal(asked.type, "ask")
  assert.deepEqual({ ...asked.ask, requestId: "…" }, {
    requestId: "…", tool: "set_translation", input: write,
    preview: { summary: "Write the translation of ¶3", segmentId: 3, before: null, after: write.text },
  })
  host.answer(ID, asked.ask.requestId, "allow")
  assert.deepEqual(await answered, { behavior: "allow", updatedInput: write })
  assert.deepEqual(events.at(-1), { type: "asked", convId: ID, requestId: asked.ask.requestId, decision: "allow" })
  assert.throws(() => host.answer(ID, asked.ask.requestId, "allow"), { status: 404 })
})

test("always allows the tool for the rest of the session only, never in a settings file", async () => {
  const { host, events, claudeAsks, write } = asking()
  const answered = claudeAsks()
  host.answer(ID, events.at(-1).ask.requestId, "always")
  assert.deepEqual(await answered, { behavior: "allow", updatedInput: write,
    updatedPermissions: [{ type: "addRules", rules: [{ toolName: "mcp__fitz__set_translation" }], behavior: "allow", destination: "session" }] })
})

test("deny tells Claude it was the translator's decision", async () => {
  const { host, events, claudeAsks } = asking()
  const answered = claudeAsks()
  host.answer(ID, events.at(-1).ask.requestId, "deny")
  const r = await answered
  assert.equal(r.behavior, "deny")
  assert.match(r.message, /translator declined/)
})

test("a page that opens while a write waits gets it in the snapshot", () => {
  const { host, claudeAsks } = asking()
  void claudeAsks()
  let snapshot
  host.open(ID, (e) => { snapshot ??= e })
  assert.equal(snapshot.asks.length, 1)
  assert.equal(snapshot.asks[0].tool, "set_translation")
})

test("a stopped turn cancels the write that waited, and so does a process that ends", async () => {
  const { events, claudeAsks, opened } = asking()
  const stop = new AbortController()
  const answered = claudeAsks(undefined, stop.signal)
  stop.abort()
  assert.match((await answered).message, /stopped before the translator answered/)
  assert.equal(events.at(-1).decision, "cancelled")
  const second = claudeAsks()
  opened[0].end()
  await settle()
  assert.equal((await second).behavior, "deny")
  assert.equal(events.filter((e) => e.type === "asked").at(-1).decision, "cancelled")
})

test("a write that cannot be described is refused at once, without asking", async () => {
  const { events, claudeAsks } = asking()
  const before = events.length
  assert.deepEqual(await claudeAsks({ segmentId: 99, text: "x", expectVersion: 1 }), { behavior: "deny", message: "segment 99 not found" })
  assert.deepEqual(await claudeAsks({ segmentId: 3, text: "x", expectVersion: 2 }), { behavior: "deny", message: "¶3 changed since you read it; read it again before writing" })
  assert.equal(events.length, before)
})

test("an answer must be one of the decisions, for a write that waits", () => {
  const { host, events, claudeAsks } = asking()
  void claudeAsks()
  assert.throws(() => host.answer(ID, events.at(-1).ask.requestId, "maybe"), { status: 400 })
  assert.throws(() => host.answer(ID, "2b6f3f2e-6a3c-4d0e-9d55-6a1c2f0e9b11", "allow"), { status: 404 })
})

// --- kept in book.db, as Octave keeps its conversations

test("a conversation is listed from the moment it starts, with its model, before it has a session", () => {
  const { host, db } = setup()
  host.start(ID, { model: "claude-sonnet-5-5", effort: "low" })
  assert.deepEqual(listConversations(db).map(({ id, sessionId, title, model, effort }) => ({ id, sessionId, title, model, effort })),
    [{ id: ID, sessionId: null, title: null, model: "claude-sonnet-5-5", effort: "low" }])
})

test("its session, each turn's time, cost and end, and the title Claude Code gave it are kept", async () => {
  const { host, db, opened } = setup({ sessionInfo: async (id) => ({ sessionId: id, summary: "Reserved 뉘앙스" }) })
  host.start(ID)
  host.send(ID, "q")
  opened[0].feed(...nuance)
  await settle()
  await settle()
  const sessionId = nuance.find((m) => m.subtype === "init").session_id
  const result = nuance.find((m) => m.type === "result")
  const echo = nuance.find((m) => m.type === "user" && m.isReplay)
  const conv = getConversation(db, ID)
  assert.deepEqual([conv.sessionId, conv.title], [sessionId, "Reserved 뉘앙스"])
  assert.deepEqual([...turnsOf(db, sessionId)], [[echo.uuid, { reason: "completed", isError: false, ms: result.duration_ms, cost: result.total_cost_usd }]])
})

test("a conversation that exists in book.db cannot be started again", () => {
  const first = setup()
  first.host.start(ID)
  const again = createAgentHost({ db: first.db, openSession: first.openSession, sessionInfo: async () => null })
  assert.throws(() => again.start(ID), { status: 409 })
})

test("a record that cannot be written does not stop the conversation", async () => {
  const { host, db, opened, events, follow } = setup()
  host.start(ID)
  follow()
  host.send(ID, "q")
  db.exec("DROP TABLE agent_turn")
  const quiet = console.error
  console.error = () => {}
  try {
    opened[0].feed(...nuance)
    await settle()
  } finally { console.error = quiet }
  assert.equal(events.filter((e) => e.type === "message").length, nuance.length)
})

// --- after a restart: the conversation comes back from book.db and Claude Code's session file, and goes on

const storedNuance = JSON.parse(readFileSync(new URL("./fixtures/nuance.stored.json", import.meta.url), "utf8"))

async function afterRestart() {
  const before = setup()
  before.host.start(ID, { model: "claude-sonnet-5-5", effort: "low" })
  before.host.send(ID, "q")
  before.opened[0].feed(...nuance)
  await settle()
  const stubs = stubSessions()
  const reads = []
  const host = createAgentHost({ db: before.db, openSession: stubs.openSession, sessionInfo: async () => null,
    sessionMessages: async (id) => { reads.push(id); return storedNuance } })
  return { host, db: before.db, reads, ...stubs }
}

test("after a restart a conversation is read back and its followers get it as it was", async () => {
  const { host, reads } = await afterRestart()
  const events = []
  host.open(ID, (e) => events.push(e))
  assert.deepEqual(events, [], "nothing until it is read back")
  await settle()
  const sessionId = nuance.find((m) => m.subtype === "init").session_id
  assert.deepEqual(reads, [sessionId])
  assert.equal(events.length, 1)
  const live = foldMessages(nuance)
  assert.deepEqual(events[0].state.items.map(({ id: _, ...i }) => i), live.items.map(({ id: _, ...i }) => i))
})

test("after a restart the next message resumes the same session with the conversation's model", async () => {
  const { host, opened } = await afterRestart()
  const uuid = await host.send(ID, "그럼 ¶5는?")
  assert.equal(uuid, "uuid-1")
  assert.equal(opened.length, 1)
  assert.deepEqual([opened[0].options.resume, opened[0].options.model, opened[0].options.effort], [nuance.find((m) => m.subtype === "init").session_id, "claude-sonnet-5-5", "low"])
  assert.deepEqual(opened[0].sent, ["그럼 ¶5는?"])
})

test("the list is book.db's, most recently used first; an unknown conversation is still refused", async () => {
  const { host } = await afterRestart()
  host.start("1b6f3f2e-6a3c-4d0e-9d55-6a1c2f0e9b11")
  assert.deepEqual(host.list().map((c) => c.id).sort(), [ID, "1b6f3f2e-6a3c-4d0e-9d55-6a1c2f0e9b11"].sort())
  assert.throws(() => host.open("2b6f3f2e-6a3c-4d0e-9d55-6a1c2f0e9b11", () => {}), { status: 404 })
})
