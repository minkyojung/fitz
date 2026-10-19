import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import { DatabaseSync } from "node:sqlite"

import { recordTurn, turnChecks, turnsOf } from "./records.mjs"

const db = () => {
  const d = new DatabaseSync(":memory:")
  d.exec(readFileSync(new URL("../../db/schema.sql", import.meta.url), "utf8"))
  return d
}

test("a turn keeps what the checks found; a turn with nothing to check keeps none", () => {
  const d = db()
  const sent = [{ segmentId: 3, kind: "term", term: "Zemurray", forms: ["제머리"] }]
  recordTurn(d, "s1", "u1", { reason: "completed", isError: false, ms: 9000, cost: 0.01, checks: { checked: [3], rounds: [sent, []] } })
  recordTurn(d, "s1", "u2", { reason: "completed", isError: false, ms: 1000, cost: 0.001 })
  assert.deepEqual(turnChecks(d, "s1"), [{ userUuid: "u1", checks: { checked: [3], rounds: [sent, []] } }])
  assert.deepEqual(turnChecks(d, "s2"), [])
  assert.deepEqual([...turnsOf(d, "s1").keys()].sort(), ["u1", "u2"], "the turns themselves as before")
  assert.equal(turnsOf(d, "s1").get("u1").checks, undefined, "checks are not part of the turn the fold shows")
})
