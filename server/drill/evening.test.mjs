import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import { DatabaseSync } from "node:sqlite"

import { stubSessions, settle } from "../agent/fixtures/stubSession.mjs"
import { execute } from "../commands.mjs"
import { watchSession } from "./cards.mjs"
import { runDrill, startEvening } from "./evening.mjs"
import { RETRY_MS } from "./schedule.mjs"

const doc = (text) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] })

/** Gatsby's chapter I with ¶3 translated today by the translator, as a logged change. */
function gatsby() {
  const db = new DatabaseSync(":memory:")
  db.exec("PRAGMA foreign_keys = ON")
  db.exec(readFileSync(new URL("../../db/schema.sql", import.meta.url), "utf8"))
  db.exec(readFileSync(new URL("../agent/fixtures/gatsby.sql", import.meta.url), "utf8"))
  execute(db, "updateSegment", { id: 3, targetDoc: doc("“누군가를 비판하고 싶어질 때면,” 아버지는 말씀하셨다. “다들 너처럼 좋은 조건을 누린 건 아니란다.”") })
  return db
}
const at = (day, hour, minute = 0) => { const [y, m, d] = day.split("-").map(Number); return new Date(y, m - 1, d, hour, minute) }
const clock = (start) => { let t = start; return { now: () => t, set: (d) => { t = d }, add: (ms) => { t = new Date(t.getTime() + ms) } } }
/** Failed runs as finished at the test's clock (the code stamps SQLite's own, real time). */
const stamp = (db, c) => db.prepare("UPDATE drill_run SET finished_at = ? WHERE status = 'failed'").run(c.now().toISOString().replace("T", " ").slice(0, 19))
const runs = (db) => db.prepare("SELECT slot, status, made, dropped, error, session_id, cost, ms, segment_ids FROM drill_run ORDER BY id").all().map((r) => ({ ...r }))
const card = { segmentId: 3, kind: "meaning", quote: "the advantages", question: "advantages는?", options: ["누린 혜택", "앞선 점수", "유리한 위치", "남은 이익"], answer: 0, why: "집안·교육" }
const success = (cards = [card], challenges = []) => [
  { type: "system", subtype: "init", session_id: "sess-1" },
  { type: "result", subtype: "success", is_error: false, duration_ms: 41000, total_cost_usd: 0.125, num_turns: 3, session_id: "sess-1", structured_output: { cards, challenges } },
]
/** Answer the session the run opened, and wait for the run to finish. */
async function answer(stub, run, messages) {
  await settle()
  stub.opened.at(-1).feed(...messages)
  return run
}

test("an evening run reads what changed, has Claude answer once, and keeps the cards", async () => {
  const db = gatsby()
  const stub = stubSessions()
  const heard = []
  watchSession(db, (e) => heard.push(e))
  const r = await answer(stub, runDrill(db, { slot: "2026-10-19", openSession: stub.openSession, today: "2026-10-19" }), success())
  assert.deepEqual(r, { id: 1, status: "done", made: 1, dropped: 0, session_id: "sess-1", cost: 0.125, ms: 41000 })
  const s = stub.opened[0]
  // a task conversation: read tools only, the drill's model, one message naming the paragraphs
  assert.equal(s.options.task, "drill")
  assert.equal(s.options.model, "claude-opus-5-5")
  assert.equal(s.sent.length, 1)
  assert.match(s.sent[0], /read\(\{ ids: \[3\] \}\)/)
  assert.equal(s.closed, true)
  assert.deepEqual(runs(db), [{ slot: "2026-10-19", status: "done", made: 1, dropped: 0, error: null, session_id: "sess-1", cost: 0.125, ms: 41000, segment_ids: "[3]" }])
  assert.equal(db.prepare("SELECT count(*) AS n FROM drill_card").get().n, 1)
  assert.deepEqual(heard, [{ run: 1 }, { run: 1 }])  // started, finished
})

test("nothing changed: the run is skipped and Claude is not called", async () => {
  const db = gatsby()
  const stub = stubSessions()
  db.prepare("INSERT INTO drill_run(slot, status) VALUES ('2026-10-18', 'done')").run()  // after today's change
  db.prepare("UPDATE ops SET created_at = '2000-01-01 00:00:00'").run()
  const r = await runDrill(db, { slot: "2026-10-19", openSession: stub.openSession, today: "2026-10-19" })
  assert.equal(r.status, "skipped")
  assert.equal(stub.opened.length, 0)
})

test("the next evening reads only what changed since the last one began", async () => {
  const db = gatsby()
  const stub = stubSessions()
  await answer(stub, runDrill(db, { slot: "2026-10-19", openSession: stub.openSession, today: "2026-10-19" }), success())
  db.prepare("UPDATE drill_run SET started_at = datetime('now', '-1 minute')").run()
  db.prepare("UPDATE ops SET created_at = datetime('now', '-2 minutes')").run()
  execute(db, "updateSegment", { id: 4, targetDoc: doc("아버지는 더 말이 없었지만, 우리는 말을 아끼면서도 유난히 잘 통했다.") })
  await answer(stub, runDrill(db, { slot: "2026-10-20", openSession: stub.openSession, today: "2026-10-20" }), success([]))
  assert.match(stub.opened[1].sent[0], /read\(\{ ids: \[4\] \}\)/)
})

test("a failed answer, a crash, or no answer in time: the run failed, with why, and its session is closed", async () => {
  const db = gatsby()
  const stub = stubSessions()
  const r1 = await answer(stub, runDrill(db, { slot: "2026-10-19", openSession: stub.openSession, today: "2026-10-19" }),
    [{ type: "result", subtype: "error_max_budget_usd", is_error: true, session_id: "sess-2", total_cost_usd: 5, duration_ms: 9 }])
  assert.deepEqual([r1.status, r1.error, r1.session_id], ["failed", "error_max_budget_usd", "sess-2"])
  const crashed = runDrill(db, { slot: "2026-10-19", openSession: stub.openSession, today: "2026-10-19" })
  await settle()
  stub.opened[1].crash(new Error("Claude Code exited with code 1"))
  assert.deepEqual([(await crashed).status, (await crashed).error], ["failed", "Claude Code exited with code 1"])
  const r3 = await runDrill(db, { slot: "2026-10-19", openSession: stub.openSession, today: "2026-10-19", timeoutMs: 20 })
  assert.deepEqual([r3.status, r3.error], ["failed", "Claude did not answer within 0 s"])
  assert.equal(stub.opened[2].interrupts, 1)
  assert.ok(stub.opened.every((s) => s.closed))
  // an answer not of the agreed shape keeps nothing
  const r4 = await answer(stub, runDrill(db, { slot: "2026-10-19", openSession: stub.openSession, today: "2026-10-19" }),
    [{ type: "result", subtype: "success", session_id: "sess-3", structured_output: { cards: "none" } }])
  assert.match(r4.error, /agreed shape/)
  assert.equal(db.prepare("SELECT count(*) AS n FROM drill_card").get().n, 0)
})

test("the clock runs the evening from 21:00, once, and not again while a run is going", async () => {
  const db = gatsby()
  const stub = stubSessions()
  const c = clock(at("2026-10-19", 20, 59))
  const evening = startEvening(db, { openSession: stub.openSession, now: c.now, enabled: false })
  assert.equal(evening.tick(), null)
  c.set(at("2026-10-19", 21, 0))
  const run = evening.tick()
  assert.ok(run)
  assert.equal(evening.tick(), null)  // one at a time
  assert.equal(evening.running(), true)
  await answer(stub, run, success())
  assert.equal(evening.running(), false)
  c.set(at("2026-10-19", 23, 30))
  assert.equal(evening.tick(), null)
  c.set(at("2026-10-20", 8))
  assert.equal(evening.tick(), null)
  c.set(at("2026-10-20", 21, 1))
  db.prepare("UPDATE ops SET created_at = '2000-01-01 00:00:00'").run()  // nothing since the last run began
  await evening.tick()
  assert.equal(stub.opened.length, 1)
  assert.deepEqual(runs(db).map((r) => [r.slot, r.status]), [["2026-10-19", "done"], ["2026-10-20", "skipped"]])
})

test("evenings missed while the server was off run once when it is back", async () => {
  const db = gatsby()
  const stub = stubSessions()
  db.prepare("INSERT INTO drill_run(slot, status, started_at) VALUES ('2026-10-16', 'done', '2000-01-01 00:00:00')").run()
  const c = clock(at("2026-10-19", 8))
  const evening = startEvening(db, { openSession: stub.openSession, now: c.now, enabled: false })
  await answer(stub, evening.tick(), success())
  assert.deepEqual(runs(db).map((r) => [r.slot, r.status]), [["2026-10-16", "done"], ["2026-10-18", "done"]])
  assert.equal(evening.tick(), null)
})

test("a failed evening is tried again ten minutes on, three times in all; Try again goes at once", async () => {
  const db = gatsby()
  const stub = stubSessions()
  const c = clock(at("2026-10-19", 21))
  const evening = startEvening(db, { openSession: stub.openSession, now: c.now, enabled: false })
  const fail = async (run) => { await settle(); stub.opened.at(-1).crash(new Error("offline")); return run }
  await fail(evening.tick())
  stamp(db, c)
  c.add(RETRY_MS - 60_000)
  assert.equal(evening.tick(), null)
  c.add(60_000)
  await fail(evening.tick())
  stamp(db, c)
  c.add(RETRY_MS)
  await fail(evening.tick())
  stamp(db, c)
  c.add(10 * RETRY_MS)
  assert.equal(evening.tick(), null)  // three times in all
  assert.deepEqual(runs(db).map((r) => r.status), ["failed", "failed", "failed"])
  await answer(stub, evening.retry(), success())
  assert.equal(runs(db).at(-1).status, "done")
  assert.throws(() => evening.retry(), /no evening run to try again/)
})

test("a run the server stopped in the middle of is failed when it starts again", () => {
  const db = gatsby()
  db.prepare("INSERT INTO drill_run(slot, status) VALUES ('2026-10-19', 'running')").run()
  startEvening(db, { openSession: () => assert.fail("no run yet"), now: () => at("2026-10-19", 9), enabled: false })
  assert.deepEqual(runs(db).map((r) => [r.status, r.error]), [["failed", "the server stopped during the run"]])
})

test("Make more reads the last week now, not while another run is going", async () => {
  const db = gatsby()
  const stub = stubSessions()
  const evening = startEvening(db, { openSession: stub.openSession, now: () => at("2026-10-19", 14), enabled: false })
  const run = evening.more()
  assert.throws(() => evening.more(), (e) => e.status === 409)
  await answer(stub, run, success())
  assert.deepEqual(runs(db).map((r) => [r.slot, r.status, r.made]), [[null, "done", 1]])
})

test("off, the clock never runs by itself", async () => {
  const db = gatsby()
  const evening = startEvening(db, { openSession: () => assert.fail("must not run"), now: () => at("2026-10-19", 22), enabled: false, every: 1 })
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.equal(evening.running(), false)
  await evening.close()
})

test("closing while a run is going closes its Claude Code", async () => {
  const db = gatsby()
  const stub = stubSessions()
  const evening = startEvening(db, { openSession: stub.openSession, now: () => at("2026-10-19", 14), enabled: false })
  const run = evening.more()
  await settle()
  await evening.close()
  assert.equal(stub.opened[0].closed, true)
  assert.equal((await run).status, "failed")  // the stream ended without an answer
})
