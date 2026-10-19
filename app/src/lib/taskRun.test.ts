import assert from "node:assert/strict"
import { test } from "node:test"

import { nextRun, type TaskRun } from "./taskRun.ts"

const running: TaskRun = { state: "running" }
const result = (m: Record<string, unknown>) => ({ type: "message", convId: "c", message: { type: "result", ...m } })

test("a run goes on through its messages and is done at its result", () => {
  assert.equal(nextRun(running, { type: "snapshot", convId: "c", state: { status: "idle", items: [] }, working: true }), running, "the snapshot at the start")
  assert.equal(nextRun(running, { type: "message", convId: "c", message: { type: "assistant" } }), running)
  assert.deepEqual(nextRun(running, result({ subtype: "success", terminal_reason: "completed", is_error: false })), { state: "done" })
})

test("a run that hits a limit, or that the server reports trouble with, has failed and says why", () => {
  assert.deepEqual(nextRun(running, result({ subtype: "error_max_turns", is_error: true })), { state: "failed", message: "Claude stopped before answering (error_max_turns)" })
  assert.deepEqual(nextRun(running, { type: "error", convId: "c", message: "Claude Code stopped: exit code 1" }), { state: "failed", message: "Claude Code stopped: exit code 1" })
})

test("after a reconnect the snapshot says whether it ended meanwhile", () => {
  const items = [{ kind: "user", text: "Review" }, { kind: "tool", name: "read" }]
  assert.equal(nextRun(running, { type: "snapshot", convId: "c", state: { status: "running", items } }), running)
  assert.deepEqual(nextRun(running, { type: "snapshot", convId: "c", state: { status: "idle", items: [...items, { kind: "turn", reason: "completed", isError: false }] } }), { state: "done" })
})

test("a snapshot no longer at work with no turn ended says the run ended without an answer (docs/agent.md §23)", () => {
  const items = [{ kind: "user", text: "Review" }, { kind: "tool", name: "read" }]
  assert.deepEqual(nextRun(running, { type: "snapshot", convId: "c", state: { status: "idle", items }, working: false }), { state: "failed", message: "Claude Code stopped before answering" })
  assert.deepEqual(nextRun(running, { type: "snapshot", convId: "c", state: { status: "idle", items: [] }, working: false }).state, "failed", "nothing said at all")
  assert.equal(nextRun(running, { type: "snapshot", convId: "c", state: { status: "idle", items } }), running, "a server that does not say goes on as before")
})

test("an ended run stays as it ended", () => {
  const failed: TaskRun = { state: "failed", message: "x" }
  assert.equal(nextRun(failed, result({ subtype: "success", is_error: false })), failed)
  assert.equal(nextRun({ state: "done" }, { type: "error", convId: "c", message: "late" }).state, "done")
})
