import assert from "node:assert/strict"
import { test } from "node:test"

import { createWarmer } from "./warm.mjs"

/** A stand-in for the SDK's startup(): each call hands out a numbered warm handle, or fails when told to. */
function fakeStartup() {
  const made = []
  let failNext = false
  const startup = async ({ options }) => {
    if (failNext) { failNext = false; throw new Error("no claude binary") }
    const handle = { n: made.length + 1, options, closed: false, query: () => `query ${made.length}`, close() { this.closed = true } }
    made.push(handle)
    return handle
  }
  return { made, startup, fail: () => { failNext = true } }
}
const settle = () => new Promise((r) => setImmediate(r))

test("one is started ahead; taking it starts the next; what take gives is the one that was ready", async () => {
  const { made, startup } = fakeStartup()
  const warmer = createWarmer({ startup, options: () => ({ cwd: "/w" }) })
  await settle()
  assert.equal(made.length, 1, "started ahead, before anyone asks")
  const first = await warmer.take()
  assert.equal(first, made[0])
  await settle()
  assert.equal(made.length, 2, "the next one is started as soon as the first is taken")
  assert.equal(await warmer.take(), made[1])
  assert.deepEqual(made.map((h) => h.options), [{ cwd: "/w" }, { cwd: "/w" }, { cwd: "/w" }], "the options are asked for afresh each time")
})

test("when starting fails, take gives null (the caller goes the cold way) and the next take tries again", async () => {
  const { made, startup, fail } = fakeStartup()
  fail()
  const warnings = []
  const warmer = createWarmer({ startup, options: () => ({}), warn: (m) => warnings.push(m) })
  assert.equal(await warmer.take(), null)
  assert.deepEqual(warnings, ["agent: could not start Claude Code ahead: no claude binary"])
  await settle()
  assert.equal(made.length, 1, "tried again after the failed one was taken")
  assert.equal(await warmer.take(), made[0])
})

test("closing closes the spare, and nothing is started after", async () => {
  const { made, startup } = fakeStartup()
  const warmer = createWarmer({ startup, options: () => ({}) })
  await settle()
  warmer.close()
  await settle()
  assert.equal(made[0].closed, true)
  assert.equal(await warmer.take(), null, "closed: the cold way")
  await settle()
  assert.equal(made.length, 1)
})
