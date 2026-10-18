import assert from "node:assert/strict"
import { test } from "node:test"

import { createLive, type LiveEvent, type SocketLike } from "./live.ts"

/** Stand-in sockets the test opens, feeds and drops. */
type Fake = { url: string; closedByPage: boolean; onopen: (() => void) | null; onmessage: ((m: { data: unknown }) => void) | null; onclose: (() => void) | null; onerror: (() => void) | null; close(): void }
function sockets() {
  const made: Fake[] = []
  const socket = (url: string): SocketLike => {
    const s: Fake = { url, closedByPage: false, onopen: null, onmessage: null, onclose: null, onerror: null, close() { s.closedByPage = true; s.onclose?.() } }
    made.push(s)
    return s as unknown as SocketLike
  }
  return { made, socket }
}
const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms))

test("events from the server reach every listener; what is not an event is ignored", () => {
  const { made, socket } = sockets()
  const live = createLive("ws://x/live", { socket })
  const a: LiveEvent[] = [], b: LiveEvent[] = []
  live.subscribe((e) => a.push(e))
  const stop = live.subscribe((e) => b.push(e))
  made[0].onopen!()
  made[0].onmessage!({ data: JSON.stringify({ type: "changed", segmentIds: [3] }) })
  stop()
  made[0].onmessage!({ data: "not json" })
  made[0].onmessage!({ data: JSON.stringify({ no: "type" }) })
  made[0].onmessage!({ data: JSON.stringify({ type: "changed", segmentIds: [4] }) })
  assert.deepEqual(a.map((e) => e.segmentIds), [[3], [4]])
  assert.deepEqual(b.map((e) => e.segmentIds), [[3]])
  live.close()
})

test("a dropped connection comes back by itself, and listeners are told to resync", async () => {
  const { made, socket } = sockets()
  const live = createLive("ws://x/live", { socket, delays: [1, 1] })
  const heard: string[] = []
  live.subscribe((e) => heard.push(e.type))
  made[0].onopen!()
  assert.deepEqual(heard, [])  // the first opening is not a resync
  made[0].onclose!()
  await tick()
  assert.equal(made.length, 2)
  assert.equal(made[1].url, "ws://x/live")
  made[1].onopen!()
  assert.deepEqual(heard, ["resync"])
  live.close()
})

test("it keeps trying while the server is away, waiting longer each time", async () => {
  const { made, socket } = sockets()
  const live = createLive("ws://x/live", { socket, delays: [1, 30] })
  made[0].onclose!()  // never opened: the server is down
  await tick()
  assert.equal(made.length, 2)
  made[1].onclose!()
  await tick()
  assert.equal(made.length, 2, "the second wait is longer")
  await tick(40)
  assert.equal(made.length, 3)
  live.close()
})

test("closed by the page, it stays closed", async () => {
  const { made, socket } = sockets()
  const live = createLive("ws://x/live", { socket, delays: [1] })
  made[0].onopen!()
  live.close()
  assert.equal(made[0].closedByPage, true)
  await tick()
  assert.equal(made.length, 1)
})
