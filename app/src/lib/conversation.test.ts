import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"

import { foldMessages, type SdkMessage } from "../../../server/agent/fold.mjs"
import { applyEvent, emptyView, readPointed, withPointed, type Ask, type ConversationView } from "./conversation.ts"
import type { LiveEvent } from "./live.ts"

const translate: SdkMessage[] = readFileSync(new URL("../../../server/agent/fixtures/translate.jsonl", import.meta.url), "utf8").trim().split("\n").map((l) => JSON.parse(l))
const ask: Ask = { requestId: "r1", tool: "set_translation", input: { segmentId: 3 }, preview: { summary: "Write the translation of ¶3", segmentId: 3, before: null, after: "번역" } }
const play = (events: LiveEvent[], view: ConversationView = emptyView()) => events.reduce(applyEvent, view)

test("nothing is shown until the snapshot; then every message folds onto it, ending where the server does", () => {
  assert.equal(emptyView().loaded, false)
  const cut = 40
  const view = play([
    { type: "snapshot", state: JSON.parse(JSON.stringify(foldMessages(translate.slice(0, cut)))), asks: [] },
    ...translate.slice(cut).map((message) => ({ type: "message", message })),
  ])
  assert.equal(view.loaded, true)
  assert.deepEqual(view.state, foldMessages(translate))
})

test("a write waits until it is answered or cancelled; a snapshot brings the ones still waiting", () => {
  let view = play([{ type: "snapshot", state: foldMessages([]), asks: [] }, { type: "ask", ask }])
  assert.deepEqual(view.asks, [ask])
  view = play([{ type: "ask", ask }], view)
  assert.equal(view.asks.length, 1, "the same ask twice is one")
  assert.deepEqual(play([{ type: "asked", requestId: "r1", decision: "allow" }], view).asks, [])
  assert.deepEqual(play([{ type: "snapshot", state: foldMessages([]), asks: [ask] }]).asks, [ask])
})

test("trouble the server reports is kept until the next snapshot", () => {
  const view = play([{ type: "snapshot", state: foldMessages([]), asks: [] }, { type: "error", message: "Claude Code stopped: exit code 1" }])
  assert.equal(view.error, "Claude Code stopped: exit code 1")
  assert.equal(play([{ type: "snapshot", state: foldMessages([]), asks: [] }], view).error, null)
})

test("the model and effort the next message goes to: from the snapshot, then as the server says they changed", () => {
  let view = play([{ type: "snapshot", state: foldMessages([]), asks: [], model: "claude-haiku-5-5", effort: "low" }])
  assert.deepEqual(view.config, { model: "claude-haiku-5-5", effort: "low" })
  view = play([{ type: "configured", model: "claude-sonnet-5-5", effort: "high" }], view)
  assert.deepEqual(view.config, { model: "claude-sonnet-5-5", effort: "high" })
  assert.equal(play([{ type: "snapshot", state: foldMessages([]), asks: [] }]).config, null, "not said: not known")
})

test("the title: from the snapshot, then as the server says Claude Code gave one (docs/agent.md §23)", () => {
  let view = play([{ type: "snapshot", state: foldMessages([]), asks: [], title: null }])
  assert.equal(view.title, null)
  view = play([{ type: "titled", title: "Reserved 뉘앙스" }], view)
  assert.equal(view.title, "Reserved 뉘앙스")
  assert.equal(play([{ type: "snapshot", state: foldMessages([]), asks: [], title: "Reserved 뉘앙스" }]).title, "Reserved 뉘앙스", "opened after")
  assert.equal(play([{ type: "snapshot", state: foldMessages([]), asks: [] }]).title, null, "not said: not known")
})

test("when the turn going on began: from the snapshot or as it starts, and none once it ends (docs/agent.md §26)", () => {
  let view = play([{ type: "snapshot", state: foldMessages([]), asks: [], startedAt: null }])
  assert.equal(view.startedAt, null)
  view = play([{ type: "started", startedAt: 1_000 }], view)
  assert.equal(view.startedAt, 1_000)
  view = play(translate.map((message) => ({ type: "message", message })), view)
  assert.equal(view.startedAt, null, "its result ended it")
  assert.equal(play([{ type: "snapshot", state: foldMessages([]), asks: [], startedAt: 2_000 }]).startedAt, 2_000, "opened mid-turn")
})

test("what the translator pointed at goes before their words, and comes apart again for showing", () => {
  const sent = withPointed("말장난이야?", { segmentId: 604, side: "source", quote: "reserve all judgments" })
  assert.equal(sent, "¶604 (English): “reserve all judgments”\n\n말장난이야?")
  assert.deepEqual(readPointed(sent), { pointed: { segmentId: 604, side: "source", quote: "reserve all judgments" }, text: "말장난이야?" })
  assert.deepEqual(readPointed(withPointed("이건?", { segmentId: 4, side: "target", quote: "유보하는" })).pointed, { segmentId: 4, side: "target", quote: "유보하는" })
  assert.deepEqual(readPointed("그냥 질문"), { pointed: null, text: "그냥 질문" })
  assert.equal(withPointed("그냥 질문", null), "그냥 질문")
})
