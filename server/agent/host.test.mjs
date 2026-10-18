import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"

import { foldMessages } from "./fold.mjs"
import { DEFAULTS, createAgentHost } from "./host.mjs"
import { settle, stubSessions } from "./fixtures/stubSession.mjs"

const nuance = readFileSync(new URL("./fixtures/nuance.jsonl", import.meta.url), "utf8").trim().split("\n").map((l) => JSON.parse(l))
const ID = "0b6f3f2e-6a3c-4d0e-9d55-6a1c2f0e9b11"
const db = { fake: "db" }

function setup() {
  const stubs = stubSessions()
  const host = createAgentHost({ db, openSession: stubs.openSession })
  const events = []
  return { ...stubs, host, events, follow: (id = ID) => host.open(id, (e) => events.push(e)) }
}

test("Claude Code starts with the first message, once, with the conversation's model and the book", () => {
  const { host, opened } = setup()
  host.start(ID)
  assert.equal(opened.length, 0)
  host.send(ID, "¶4는?")
  host.send(ID, "그럼 ¶5는?")
  assert.equal(opened.length, 1)
  assert.deepEqual(opened[0].options, { db, resume: undefined, model: DEFAULTS.model, effort: DEFAULTS.effort })
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
