import assert from "node:assert/strict"
import { test } from "node:test"

import { MAX_TEXT, parseClientMessage } from "./protocol.mjs"

const ID = "0b6f3f2e-6a3c-4d0e-9d55-6a1c2f0e9b11"
const parse = (m) => parseClientMessage(JSON.stringify(m))

test("the five page messages, with only their own fields", () => {
  assert.deepEqual(parse({ type: "start", convId: ID }), { type: "start", convId: ID })
  assert.deepEqual(parse({ type: "start", convId: ID, model: "claude-sonnet-5-5", effort: "low", extra: 1 }), { type: "start", convId: ID, model: "claude-sonnet-5-5", effort: "low" })
  assert.deepEqual(parse({ type: "start", convId: ID, task: "typos", chapterId: 3 }), { type: "start", convId: ID, task: "typos", chapterId: 3 })
  assert.deepEqual(parse({ type: "open", convId: ID, text: "x" }), { type: "open", convId: ID })
  assert.deepEqual(parse({ type: "send", convId: ID, text: "¶4는?" }), { type: "send", convId: ID, text: "¶4는?" })
  assert.deepEqual(parse({ type: "stop", convId: ID }), { type: "stop", convId: ID })
  assert.deepEqual(parse({ type: "answer", convId: ID, requestId: ID, decision: "always" }), { type: "answer", convId: ID, requestId: ID, decision: "always" })
})

test("anything else is refused with a reason", () => {
  const refused = (raw, why) => assert.throws(() => parseClientMessage(raw), { status: 400, message: why })
  refused("{", /not JSON/)
  refused("[]", /not an object/)
  refused("null", /not an object/)
  refused(JSON.stringify({ type: "approve", convId: ID }), /unknown message type "approve"/)
  refused(JSON.stringify({ type: "answer", convId: ID, requestId: "r1", decision: "allow" }), /requestId must be a uuid/)
  refused(JSON.stringify({ type: "answer", convId: ID, requestId: ID, decision: "yes" }), /decision must be one of allow, always, deny/)
  refused(JSON.stringify({ type: "send", convId: "1", text: "x" }), /convId must be a uuid/)
  refused(JSON.stringify({ type: "send", convId: ID, text: "  " }), /non-empty string/)
  refused(JSON.stringify({ type: "send", convId: ID, text: 5 }), /non-empty string/)
  refused(JSON.stringify({ type: "send", convId: ID, text: "x".repeat(MAX_TEXT + 1) }), /longer than/)
  refused(JSON.stringify({ type: "start", convId: ID, effort: "huge" }), /effort must be one of/)
  refused(JSON.stringify({ type: "start", convId: ID, model: "opus; rm -rf /" }), /not a model name/)
  refused(JSON.stringify({ type: "start", convId: ID, task: "translate", chapterId: 3 }), /task must be one of review, typos/)
  refused(JSON.stringify({ type: "start", convId: ID, task: "review" }), /needs the chapterId/)
  refused(JSON.stringify({ type: "start", convId: ID, task: "review", chapterId: "3" }), /needs the chapterId/)
})
