// Session's evening run (docs/session.md §4): every evening at 21:00 the server has Claude make cards from the
// paragraphs whose translation changed since the last evening run began. The server's own clock, checked every minute
// rather than set once for hours — a sleeping Mac holds a long timer back. An evening missed while the server was off
// or the Mac asleep runs when it is back; a failed run is tried again ten minutes on, three times in all, then waits
// for the translator's Try again.
import { DRILL } from "../agent/tasks.mjs"
import { httpError } from "../commands.mjs"
import { announceSession, drillInput, saveCards } from "./cards.mjs"
import { dayOf, eveningDue, retryAllowed } from "./schedule.mjs"

/** A run stops waiting for Claude after this long (measured: under a minute for 19 paragraphs). */
export const RUN_TIMEOUT_MS = 10 * 60_000

/** A time as SQLite keeps it (datetime('now'): UTC, no zone written). */
const sqliteTime = (text) => new Date(`${text.replace(" ", "T")}Z`)
const lastDone = (db) => db.prepare("SELECT max(slot) AS slot FROM drill_run WHERE slot IS NOT NULL AND status IN ('done', 'skipped')").get().slot ?? null
/** When the last evening run that finished began: the next one's material starts there; null before any. */
export const lastEveningStart = (db) =>
  db.prepare("SELECT max(started_at) AS t FROM drill_run WHERE slot IS NOT NULL AND status IN ('done', 'skipped')").get().t ?? null

/** The session's answer: its result message and its id. The timeout does not wait for the stream to end — once it has
 *  passed, how the stream ends is not this run's business. */
async function answerOf(session, timeoutMs) {
  let sessionId = null
  const read = (async () => {
    for await (const m of session.messages) {
      sessionId ??= m.session_id ?? null
      if (m.type === "result") return m
    }
    throw new Error("Claude Code ended without an answer")
  })()
  read.catch(() => {})
  let timer
  // unref: a run left waiting does not keep the process alive (the server's own socket does that)
  const late = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`Claude did not answer within ${Math.round(timeoutMs / 1000)} s`)), timeoutMs); timer.unref() })
  try {
    return { result: await Promise.race([read, late]), sessionId: () => sessionId }
  } catch (e) {
    void session.interrupt()
    throw Object.assign(e, { sessionId })
  } finally {
    clearTimeout(timer)
  }
}

/** One run, kept in drill_run as it goes: the evening `slot`'s, on what changed since the last evening run began; or,
 *  without a slot, Make more, on what changed in the last `days` days. Nothing to read: skipped, Claude not called.
 *  Never throws — a failure is the run's status and why; the session is closed whatever happens. */
export async function runDrill(db, { slot = null, days = 7, openSession, today, timeoutMs = RUN_TIMEOUT_MS, onOpen }) {
  const since = slot ? lastEveningStart(db) : null
  const id = Number(db.prepare("INSERT INTO drill_run(slot, status) VALUES (?, 'running')").run(slot).lastInsertRowid)
  announceSession(db, { run: id })
  const finish = (fields) => {
    const cols = Object.keys(fields)
    db.prepare(`UPDATE drill_run SET ${cols.map((c) => `${c} = ?`).join(", ")}, finished_at = datetime('now') WHERE id = ?`).run(...cols.map((c) => fields[c]), id)
    announceSession(db, { run: id })
    return { id, ...fields }
  }
  let session = null
  try {
    const input = drillInput(db, slot ? { since } : { days })
    db.prepare("UPDATE drill_run SET segment_ids = ? WHERE id = ?").run(JSON.stringify(input.ids), id)
    if (input.ids.length === 0) return finish({ status: "skipped" })
    session = openSession({
      db, model: DRILL.model, effort: DRILL.effort, task: "drill", wrote: () => {},
      ask: async () => ({ behavior: "deny", message: "This conversation only reads." }),
    })
    onOpen?.(session)
    session.send(DRILL.prompt(input))
    const { result, sessionId } = await answerOf(session, timeoutMs)
    const spent = { session_id: sessionId(), cost: result.total_cost_usd ?? null, ms: result.duration_ms ?? null }
    if (result.subtype !== "success" || result.structured_output === undefined) {
      return finish({ status: "failed", error: `${result.subtype}${result.errors?.length ? `: ${result.errors.join("; ")}` : ""}`, ...spent })
    }
    const { made, dropped } = saveCards(db, { runId: id, answer: result.structured_output, input, today })
    for (const d of dropped) console.error(`session: a ${d.kind} card on ¶${d.segmentId} was not kept: ${d.why}`)
    return finish({ status: "done", made, dropped: dropped.length, ...spent })
  } catch (e) {
    return finish({ status: "failed", error: e.message, ...(e.sessionId && { session_id: e.sessionId }) })
  } finally {
    await session?.close()
  }
}

/** The evening clock. Checks at once and then `every` ms whether an evening run is due, and runs it — one run at a
 *  time, Make more included. Off (`enabled: false`), it never runs by itself; Try again and Make more still work. */
export function startEvening(db, { openSession, now = () => new Date(), every = 60_000, enabled = true, timeoutMs }) {
  // a run the server stopped in the middle of never finished
  db.prepare("UPDATE drill_run SET status = 'failed', error = 'the server stopped during the run', finished_at = datetime('now') WHERE status = 'running'").run()
  let running = null
  let session = null  // the running one's, closed if the server stops
  const go = (opts) => {
    running = runDrill(db, { openSession, today: dayOf(now()), timeoutMs, onOpen: (s) => { session = s }, ...opts })
      .finally(() => { running = null; session = null })
    return running
  }
  const busy = () => { if (running) throw httpError(409, "Claude is making cards now") }
  const tick = () => {
    if (running) return null
    const slot = eveningDue(now(), lastDone(db))
    if (!slot) return null
    const failed = db.prepare("SELECT count(*) AS n, max(finished_at) AS last FROM drill_run WHERE slot = ? AND status = 'failed'").get(slot)
    if (!retryAllowed(failed.n, failed.last && sqliteTime(failed.last), now())) return null
    return go({ slot })
  }
  const timer = enabled ? setInterval(tick, every) : null
  timer?.unref()
  if (enabled) tick()
  return {
    tick,
    running: () => running !== null,
    /** The translator's Try again: tonight's run now, however often it failed. */
    retry() {
      busy()
      const slot = eveningDue(now(), lastDone(db))
      if (!slot) throw httpError(409, "there is no evening run to try again")
      return go({ slot })
    },
    /** Make more: from what changed in the last week, now. */
    more() { busy(); return go({ days: 7 }) },
    /** The clock stopped and a running run's Claude Code closed: the server is going. The run is failed on the next start. */
    async close() { if (timer) clearInterval(timer); await session?.close() },
  }
}
