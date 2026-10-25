import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"

import { DatabaseSync } from "node:sqlite"

import { foldMessages } from "./fold.mjs"
import { DEFAULTS, TRIES, createAgentHost } from "./host.mjs"
import { getConversation, listConversations, turnChecks, turnsOf } from "./records.mjs"
import { settle, stubSessions } from "./fixtures/stubSession.mjs"
import { TASKS } from "./tasks.mjs"
import { execute, pmDoc } from "../commands.mjs"

const nuance = readFileSync(new URL("./fixtures/nuance.jsonl", import.meta.url), "utf8").trim().split("\n").map((l) => JSON.parse(l))
const ID = "0b6f3f2e-6a3c-4d0e-9d55-6a1c2f0e9b11"

/** Session copies, recorded instead of made: a test never touches the home folder. */
const keeper = (saved = () => 0) => { const calls = []; return { calls, save: (id) => { calls.push(["save", id]); return true }, restore: (id) => { calls.push(["restore", id]); return false }, savedCost: saved } }

function setup({ sessionInfo = async () => null, saved } = {}) {
  const stubs = stubSessions()
  const db = gatsby()
  const keep = keeper(saved)
  const host = createAgentHost({ db, openSession: stubs.openSession, sessionInfo, keep })
  const events = []
  return { ...stubs, db, keep, host, events, follow: (id = ID) => host.open(id, (e) => events.push(e)) }
}

test("Claude Code starts with the first message, once, with the conversation's model and the book", () => {
  const { host, opened, db } = setup()
  host.start(ID)
  assert.equal(opened.length, 0)
  host.send(ID, "¶4는?")
  host.send(ID, "그럼 ¶5는?")
  assert.equal(opened.length, 1)
  const { ask, wrote, stop, ...options } = opened[0].options
  assert.deepEqual(options, { db, resume: undefined, model: DEFAULTS.model, effort: DEFAULTS.effort, task: null })
  assert.deepEqual([typeof ask, typeof wrote, typeof stop], ["function", "function", "function"])
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
  assert.deepEqual(events.map((e) => e.type), ["snapshot", "started"], "the turn began while it still followed")
  await host.close()
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
  const host = createAgentHost({ db: gatsby(), openSession: stubs.openSession, sessionInfo: async () => null, keep: keeper() })
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
  const again = createAgentHost({ db: first.db, openSession: first.openSession, sessionInfo: async () => null, keep: keeper() })
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

async function afterRestart({ saved } = {}) {
  const before = setup()
  before.host.start(ID, { model: "claude-sonnet-5-5", effort: "low" })
  before.host.send(ID, "q")
  before.opened[0].feed(...nuance)
  await settle()
  const stubs = stubSessions()
  const reads = []
  const keep = keeper(saved)
  const host = createAgentHost({ db: before.db, openSession: stubs.openSession, sessionInfo: async () => null, keep,
    sessionMessages: async (id) => { reads.push(id); return storedNuance } })
  return { host, db: before.db, reads, keep, before, ...stubs }
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

test("each finished turn copies its session file; a reopened or resumed session is restored first if it was swept", async () => {
  const { host, keep, before } = await afterRestart()
  const sessionId = nuance.find((m) => m.subtype === "init").session_id
  assert.deepEqual(before.keep.calls, [["save", sessionId]])
  host.open(ID, () => {})
  await settle()
  await host.send(ID, "그럼 ¶5는?")
  assert.deepEqual(keep.calls, [["restore", sessionId], ["restore", sessionId]])
})

// --- tasks: the app starts them on a chapter; Claude reads it and answers in the task's shape

const ID2 = "1b6f3f2e-6a3c-4d0e-9d55-6a1c2f0e9b11"
const CHAPTER = { id: 1, idx: 0, title: "Chapter I" }  // gatsby.sql's one chapter

test("a task conversation sets to work at once on its chapter, as that task, with the task's model", () => {
  const { host, opened, db } = setup()
  host.start(ID, { task: "review", chapterId: 1 })
  assert.equal(opened.length, 1)
  assert.deepEqual([opened[0].options.task, opened[0].options.model, opened[0].options.effort], ["review", TASKS.review.model, TASKS.review.effort])
  assert.deepEqual(opened[0].sent, [TASKS.review.prompt(CHAPTER)])
  const { task, chapterId, model } = getConversation(db, ID)
  assert.deepEqual({ task, chapterId, model }, { task: "review", chapterId: 1, model: TASKS.review.model })
  host.start(ID2, { task: "typos", chapterId: 1, model: "claude-opus-5-5" })
  assert.deepEqual([opened[1].options.task, opened[1].options.model], ["typos", "claude-opus-5-5"])
  assert.deepEqual(opened[1].sent, [TASKS.typos.prompt(CHAPTER)])
})

test("a free conversation has no task and no chapter", () => {
  const { host, db } = setup()
  host.start(ID, { chapterId: 1 })
  const { task, chapterId } = getConversation(db, ID)
  assert.deepEqual({ task, chapterId }, { task: null, chapterId: null })
})

test("a task needs a chapter that exists, and only the known tasks run; a refused start keeps nothing", () => {
  const { host, opened, db } = setup()
  assert.throws(() => host.start(ID, { task: "review", chapterId: 99 }), { status: 404, message: /no chapter 99/ })
  assert.throws(() => host.start(ID, { task: "review" }), { status: 404 })
  assert.throws(() => host.start(ID, { task: "translate", chapterId: 1 }), { status: 400 })
  assert.throws(() => host.start(ID, { task: "toString", chapterId: 1 }), { status: 400 })
  assert.equal(opened.length, 0)
  assert.equal(getConversation(db, ID), null)
  host.start(ID, { task: "review", chapterId: 1 })
})

test("after a restart a task conversation goes on as the same task", async () => {
  const before = setup()
  before.host.start(ID, { task: "typos", chapterId: 1 })
  before.opened[0].feed(...nuance)
  await settle()
  const stubs = stubSessions()
  const host = createAgentHost({ db: before.db, openSession: stubs.openSession, sessionInfo: async () => null, keep: keeper(), sessionMessages: async () => storedNuance })
  await host.send(ID, "¶3도 다시 봐줘")
  const { task, model, resume } = stubs.opened[0].options
  assert.deepEqual({ task, model, resume }, { task: "typos", model: TASKS.typos.model, resume: nuance.find((m) => m.subtype === "init").session_id })
})

test("a task's answer is kept as suggestions before its result is told; one of another shape is told as an error", async () => {
  const { host, opened, db, events, follow } = setup()
  const quote = "쉽게 상처받던"
  const answer = { suggestions: [{ segmentId: 2, quote, replacement: "여리던", why: "-", level: "low" }] }
  const answered = (structured_output) => nuance.map((m) => (m.type === "result" ? { ...m, structured_output } : m))
  const kept = () => db.prepare("SELECT quote FROM agent_suggestion").all().map((r) => r.quote)
  host.start(ID, { task: "review", chapterId: 1 })
  let atResult
  host.open(ID, (e) => { if (e.type === "message" && e.message.type === "result") atResult = kept() })
  opened[0].feed(...answered(answer))
  await settle()
  assert.deepEqual(atResult, [quote])

  host.start(ID2, { task: "review", chapterId: 1 })
  follow(ID2)
  opened[1].feed(...answered({ findings: [] }))
  await settle()
  assert.match(events.find((e) => e.type === "error").message, /could not be kept: the review answer does not have the agreed shape/)
  assert.deepEqual(kept(), [quote])
  assert.equal(events.at(-1).message.type, "result", "the conversation goes on")
})

test("a free conversation's result keeps no suggestions", async () => {
  const { host, opened, db } = setup()
  host.start(ID)
  host.send(ID, "q")
  opened[0].feed(...nuance.map((m) => (m.type === "result" ? { ...m, structured_output: { suggestions: [{ segmentId: 2, quote: "쉽게 상처받던", replacement: "x", why: "-", level: "low" }] } } : m)))
  await settle()
  assert.equal(db.prepare("SELECT count(*) n FROM agent_suggestion").get().n, 0)
})

test("the real recorded answers are kept: the OCR errors planted in the source, the reversed meaning in the translation", async () => {
  const { host, opened, db } = setup()
  db.exec(readFileSync(new URL("./fixtures/gatsby-tasks.sql", import.meta.url), "utf8"))
  const recorded = (name) => readFileSync(new URL(`./fixtures/${name}.jsonl`, import.meta.url), "utf8").trim().split("\n").map((l) => JSON.parse(l))
  host.start(ID, { task: "typos", chapterId: 1 })
  host.start(ID2, { task: "review", chapterId: 1 })
  opened[0].feed(...recorded("typos"))
  opened[1].feed(...recorded("review"))
  await settle()
  const kept = db.prepare("SELECT task, segment_id, side, quote, replacement, level FROM agent_suggestion ORDER BY id").all().map((r) => ({ ...r }))
  assert.deepEqual(kept.filter((s) => s.task === "typos").map((s) => [s.segment_id, s.side, s.quote, s.replacement]),
    [[2, "source", "tuming", "turning"], [4, "source", "matures", "natures"], [5, "source", "rnind", "mind"], [5, "source", "unjust1y", "unjustly"]])
  const review = kept.filter((s) => s.task === "review")
  assert.deepEqual(review.map((s) => [s.segment_id, s.side, s.level]), [[4, "target", "high"]])
  assert.match(review[0].quote, /서둘러 내리는/)
})

// --- the checks of a turn's translations (docs/agent.md §19): the Stop hook is called here as Claude Code would

const signal = () => new AbortController().signal
const write = (db, id, text) => execute(db, "updateSegment", { id, targetDoc: JSON.parse(pmDoc(text)) }, { actor: "agent", toolUseId: "toolu_t" })
const turnOf = (db) => {
  const sessionId = nuance.find((m) => m.subtype === "init").session_id
  return turnChecks(db, sessionId).find((t) => t.userUuid === (nuance.find((m) => m.type === "result").user_message_uuid ?? nuance.find((m) => m.type === "result").uuid))?.checks ?? null
}

test("a turn that translated is checked when Claude would stop: sent back with what is wrong, then passes; the turn keeps both", async () => {
  const { host, opened, db } = setup()
  execute(db, "setGlossaryTerm", { bookId: 1, term: "advantages", translation: "혜택" })
  host.start(ID)
  host.send(ID, "¶3을 번역해 넣어줘")
  const s = opened[0].options
  write(db, 3, "“…” 아버지는 말씀하셨다. “다들 너처럼 유리한 처지는 아니란다.”")
  s.wrote(3)
  const sent = await s.stop({ stop_hook_active: false }, { signal: signal() })
  assert.equal(sent.decision, "block")
  assert.match(sent.reason, /¶3: the source has “advantages”; the glossary's agreed form is “혜택”/)
  write(db, 3, "“…” 아버지는 말씀하셨다. “다들 너처럼 혜택을 누린 건 아니란다.”")
  s.wrote(3)
  assert.deepEqual(await s.stop({ stop_hook_active: true }, { signal: signal() }), {})
  opened[0].feed(...nuance)
  await settle()
  const checks = turnOf(db)
  assert.deepEqual(checks.checked, [3])
  assert.equal(checks.rounds.length, 2, "sent back once")
  assert.deepEqual(checks.rounds[1], [], "and then nothing wrong")
})

test(`sent back at most ${TRIES} times; then what is left wrong is the verdict`, async () => {
  const { host, opened, db } = setup()
  execute(db, "setGlossaryTerm", { bookId: 1, term: "advantages", translation: "혜택" })
  host.start(ID)
  host.send(ID, "q")
  write(db, 3, "유리한 처지")
  opened[0].options.wrote(3)
  const answers = []
  for (let i = 0; i <= TRIES; i++) {
    answers.push((await opened[0].options.stop({}, { signal: signal() })).decision ?? "pass")
    write(db, 3, `유리한 처지 ${i}`)  // Claude rewrites each time it is sent back, still without the agreed form
    opened[0].options.wrote(3)
  }
  assert.deepEqual(answers, [...Array(TRIES).fill("block"), "pass"])
  opened[0].feed(...nuance)
  await settle()
  const checks = turnOf(db)
  assert.equal(checks.rounds.length, TRIES + 1)
  assert.equal(checks.rounds.at(-1)[0].term, "advantages")
})

test("nothing translated, nothing to check; a turn the translator stopped is not judged", async () => {
  const quiet = setup()
  quiet.host.start(ID)
  quiet.host.send(ID, "q")
  assert.deepEqual(await quiet.opened[0].options.stop({}, { signal: signal() }), {})
  quiet.opened[0].feed(...nuance)
  await settle()
  assert.equal(turnOf(quiet.db), null)

  const { host, opened, db } = setup()
  execute(db, "setGlossaryTerm", { bookId: 1, term: "advantages", translation: "혜택" })
  host.start(ID)
  host.send(ID, "q")
  write(db, 3, "유리한 처지")
  opened[0].options.wrote(3)
  host.stop(ID)
  assert.deepEqual(await opened[0].options.stop({}, { signal: signal() }), {})
  opened[0].feed(...nuance)
  await settle()
  assert.equal(turnOf(db), null)
})

test("a check that cannot run says so; it is not a pass", async () => {
  const { host, opened, db } = setup()
  host.start(ID)
  host.send(ID, "q")
  write(db, 3, "번역")
  opened[0].options.wrote(3)
  db.exec("DROP TABLE glossary")
  const quiet = console.error
  console.error = () => {}
  try { assert.deepEqual(await opened[0].options.stop({}, { signal: signal() }), {}) } finally { console.error = quiet }
  opened[0].feed(...nuance)
  await settle()
  assert.match(turnOf(db).error, /^could not check: /)
})

test("a task conversation has no Stop hook: it writes nothing", () => {
  const { host, opened } = setup()
  host.start(ID, { task: "review", chapterId: 1 })
  assert.equal(opened[0].options.stop, undefined)
})

test("sent back, Claude may say the form is right as it is: if it writes nothing more, it is not sent back again", async () => {
  const { host, opened, db } = setup()
  execute(db, "setGlossaryTerm", { bookId: 1, term: "advantages", translation: "혜택" })
  host.start(ID)
  host.send(ID, "advantages는 '유리한 조건'으로 옮겨서 ¶3을 넣어줘")
  write(db, 3, "유리한 조건")
  opened[0].options.wrote(3)
  assert.equal((await opened[0].options.stop({}, { signal: signal() })).decision, "block")
  assert.deepEqual(await opened[0].options.stop({}, { signal: signal() }), {}, "it answered why, writing nothing: the translator's call")
  opened[0].feed(...nuance)
  await settle()
  const checks = turnOf(db)
  assert.equal(checks.rounds.length, 2)
  assert.equal(checks.rounds[1][0].term, "advantages", "and the verdict says what is left")
})

test("the model and effort change from the next message: Claude Code is told only what changed, the record and the followers too", async () => {
  const { host, opened, db, events, follow } = setup()
  host.start(ID, { model: "claude-haiku-5-5", effort: "low" })
  follow()
  assert.deepEqual([events[0].model, events[0].effort], ["claude-haiku-5-5", "low"], "the snapshot says what the next message goes to")
  host.send(ID, "q")
  opened[0].feed(...nuance)
  await settle()
  await host.configure(ID, { model: "claude-sonnet-5-5", effort: "low" })
  await host.configure(ID, { effort: "high" })
  assert.deepEqual(opened[0].configured, [{ model: "claude-sonnet-5-5" }, { effort: "high" }])
  assert.deepEqual(events.filter((e) => e.type === "configured").map(({ model, effort }) => [model, effort]),
    [["claude-sonnet-5-5", "low"], ["claude-sonnet-5-5", "high"]])
  const { model, effort } = getConversation(db, ID)
  assert.deepEqual([model, effort], ["claude-sonnet-5-5", "high"])
  host.send(ID, "q2")
  assert.equal(opened.length, 1, "the same Claude Code goes on")
})

test("with no Claude Code running only the record changes, and the next one opens with it", async () => {
  const { host, opened } = setup()
  host.start(ID)
  await host.configure(ID, { model: "claude-haiku-5-5", effort: "high" })
  host.send(ID, "q")
  assert.deepEqual([opened[0].options.model, opened[0].options.effort], ["claude-haiku-5-5", "high"])
  assert.deepEqual(opened[0].configured, [])
})

test("not while Claude answers, not for a task, and what Claude Code could not be told is not recorded", async () => {
  const { host, opened, db, events, follow } = setup()
  host.start(ID)
  follow()
  host.send(ID, "q")
  opened[0].feed(...nuance.slice(0, 5))
  await settle()
  await assert.rejects(host.configure(ID, { model: "claude-haiku-5-5" }), { status: 409 })
  opened[0].feed(...nuance.slice(5))
  await settle()
  opened[0].refuseConfigure = new Error("Claude Code has exited")
  await assert.rejects(host.configure(ID, { model: "claude-haiku-5-5" }), /exited/)
  assert.equal(getConversation(db, ID).model, DEFAULTS.model)
  assert.equal(events.filter((e) => e.type === "configured").length, 0)
  const TASK = "1b6f3f2e-6a3c-4d0e-9d55-6a1c2f0e9b11"
  host.start(TASK, { task: "review", chapterId: 1 })
  await assert.rejects(host.configure(TASK, { model: "claude-haiku-5-5" }), { status: 400 })
})

test("a conversation whose Claude Code died mid-turn can be changed, and resumes with the change", async () => {
  const { host, opened } = setup()
  host.start(ID)
  host.send(ID, "q")
  opened[0].feed(...nuance.slice(0, 5))
  opened[0].crash(new Error("killed"))
  await settle()
  await host.configure(ID, { model: "claude-haiku-5-5" })
  host.send(ID, "q2")
  assert.equal(opened[1].options.model, "claude-haiku-5-5")
})

// --- what a page opened again needs to know (docs/agent.md §23)

test("a task at work says so in the list and its snapshot, until its result, or until its Claude Code dies", async () => {
  const { host, opened, events, follow } = setup()
  const working = (id) => host.list().find((c) => c.id === id)?.working
  host.start(ID, { task: "review", chapterId: 1 })
  assert.equal(working(ID), true, "at work from its start, before Claude Code has said anything")
  follow()
  assert.deepEqual([events[0].type, events[0].working], ["snapshot", true])
  opened[0].feed(...nuance.slice(0, 50))
  await settle()
  assert.equal(working(ID), true)
  opened[0].feed(...nuance.slice(50))
  await settle()
  assert.equal(working(ID), false, "its result ends it")

  host.start(ID2, { task: "typos", chapterId: 1 })
  opened[1].feed(...nuance.slice(0, 50))
  await settle()
  opened[1].crash(new Error("exit code 1"))
  await settle()
  assert.equal(working(ID2), false, "a Claude Code that died ends it")

  const free = "2b6f3f2e-6a3c-4d0e-9d55-6a1c2f0e9b11"
  host.start(free)
  assert.equal(working(free), false, "a free conversation waits for its first message")
})

test("after a restart a conversation known only from book.db is not at work, and its snapshot says so", async () => {
  const { host } = await afterRestart()
  assert.equal(host.list().find((c) => c.id === ID).working, false)
  const events = []
  host.open(ID, (e) => events.push(e))
  await settle()
  assert.deepEqual([events[0].type, events[0].working], ["snapshot", false])
})

test("a task whose Claude Code ends before saying anything tells its followers it is no longer at work", async () => {
  const { host, opened, events, follow } = setup()
  host.start(ID, { task: "review", chapterId: 1 })
  follow()
  opened[0].end()
  await settle()
  assert.deepEqual([events.at(-1).type, events.at(-1).working, events.at(-1).state.items.length], ["snapshot", false, 0])
})

test("the title Claude Code gives a conversation is told to its followers, and is in the snapshot of whoever opens it after", async () => {
  const { host, opened, events, follow } = setup({ sessionInfo: async (id) => ({ sessionId: id, summary: "Reserved 뉘앙스" }) })
  host.start(ID)
  follow()
  assert.equal(events[0].title, null, "none before its first turn ends")
  host.send(ID, "q")
  opened[0].feed(...nuance)
  await settle()
  await settle()
  assert.deepEqual(events.filter((e) => e.type === "titled"), [{ type: "titled", convId: ID, title: "Reserved 뉘앙스" }])
  const later = []
  host.open(ID, (e) => later.push(e))
  assert.deepEqual([later[0].type, later[0].title], ["snapshot", "Reserved 뉘앙스"])
})

// --- a resumed Claude Code's first turn (docs/agent.md §24)

const SESSION = nuance.find((m) => m.subtype === "init").session_id
const RESULT = nuance.find((m) => m.type === "result")
/** The cost of the last turn as a page folds it: from its snapshot, then the messages after. */
const lastTurnCost = (events) => {
  const at = events.findLastIndex((e) => e.type === "snapshot")
  return foldMessages(events.slice(at + 1).filter((e) => e.type === "message").map((e) => e.message), events[at].state).items.at(-1).cost
}
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} is not ${b}`)

test("after a restart the first turn costs what it added: spent counts on from what the session file saved", async () => {
  const saved = foldMessages(nuance).spent  // the first process's last running total, saved as it ended
  const { host, opened, db } = await afterRestart({ saved: () => saved })
  const events = []
  host.open(ID, (e) => events.push(e))
  await settle()
  assert.equal(events[0].state.spent, saved, "in the snapshot: the page counts from it too")
  host.send(ID, "그럼 ¶5는?")
  opened[0].feed({ ...RESULT, uuid: "r2", user_message_uuid: "u2", total_cost_usd: saved + 0.003 })
  await settle()
  near(lastTurnCost(events), 0.003)
  near(turnsOf(db, SESSION).get("u2").cost, 0.003)
})

test("a Claude Code that died counts on from what its session file saved, not from its last result; followers are told", async () => {
  const { host, opened, events, follow } = setup({ saved: () => 0 })  // it died before it saved anything
  host.start(ID)
  follow()
  host.send(ID, "q")
  opened[0].feed(...nuance)
  await settle()
  opened[0].crash(new Error("exit code 1"))
  await settle()
  assert.equal(events.at(-1).type, "snapshot")
  assert.equal(events.at(-1).state.spent, 0)
  host.send(ID, "그럼 ¶5는?")
  opened[1].feed({ ...RESULT, uuid: "r2", user_message_uuid: "u2", total_cost_usd: 0.003 })
  await settle()
  near(lastTurnCost(events), 0.003)
})

// --- when the turn began, for the time on the live line (docs/agent.md §26)

test("a turn's start is told to its followers as it begins, and is in the snapshot while it is at work", async () => {
  const { host, opened, events, follow } = setup()
  host.start(ID)
  follow()
  assert.equal(events[0].startedAt, null, "nothing at work")
  const before = Date.now()
  host.send(ID, "q")
  const started = events.find((e) => e.type === "started")
  assert.equal(started?.convId, ID)
  assert.ok(started.startedAt >= before && started.startedAt <= Date.now())
  const opener = []
  host.open(ID, (e) => opener.push(e))
  assert.equal(opener[0].startedAt, started.startedAt, "a page opened mid-turn counts from the same moment")
  opened[0].feed(...nuance)
  await settle()
  const after = []
  host.open(ID, (e) => after.push(e))
  assert.equal(after[0].startedAt, null, "once it ended, no start")
})

// --- a compaction (docs/agent.md §32)

test("a /compact is not recorded as a turn: the recording's three results leave two", async () => {
  const compact = readFileSync(new URL("./fixtures/compact.jsonl", import.meta.url), "utf8").trim().split("\n").map((l) => JSON.parse(l))
  const { host, opened, db } = setup()
  host.start(ID)
  host.send(ID, "¶4를 읽고 한 줄로 요약해.")
  opened[0].feed(...compact)
  await settle()
  await settle()
  const sessionId = compact.find((m) => m.subtype === "init").session_id
  assert.equal(turnsOf(db, sessionId).size, 2)
})

test("compact sends Claude Code's /compact as a message, told as a start; not for a task, not mid-turn; the usage is null without a process", async () => {
  const { host, opened, events, follow } = setup()
  host.start(ID)
  follow()
  assert.equal(await host.context(ID), null, "no Claude Code yet")
  host.send(ID, "q")
  await settle()
  await assert.rejects(async () => host.compact(ID), { status: 409 })
  opened[0].feed(...nuance)
  await settle()
  host.compact(ID)
  assert.equal(opened[0].sent.at(-1), "/compact")
  assert.equal(events.filter((e) => e.type === "started").length, 2)
  host.start(ID2, { task: "review", chapterId: 1 })
  await assert.rejects(async () => host.compact(ID2), { status: 400 })
})
