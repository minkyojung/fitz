import assert from "node:assert/strict"
import { test } from "node:test"

import { addDays, afterAnswer, dayOf, eveningDue, retryAllowed, RETRY_MS } from "./schedule.mjs"

// moments are made in the local time zone, as the server's clock gives them; the suite is also run under TZ=UTC
const at = (day, hour, minute = 0) => { const [y, m, d] = day.split("-").map(Number); return new Date(y, m - 1, d, hour, minute) }

test("a moment's day is the local one, early morning included", () => {
  assert.equal(dayOf(at("2026-10-19", 0, 30)), "2026-10-19")
  assert.equal(dayOf(at("2026-10-19", 8)), "2026-10-19")
  assert.equal(dayOf(at("2026-10-19", 23, 59)), "2026-10-19")
})

test("days add across months, years and a leap day, and back", () => {
  assert.equal(addDays("2026-10-19", 1), "2026-10-20")
  assert.equal(addDays("2026-10-31", 1), "2026-11-01")
  assert.equal(addDays("2026-12-31", 1), "2027-01-01")
  assert.equal(addDays("2028-02-28", 1), "2028-02-29")
  assert.equal(addDays("2026-03-01", -1), "2026-02-28")
  assert.equal(addDays("2026-10-19", 16), "2026-11-04")
})

test("right moves a card up a box and further off; wrong sends it to box 1, tomorrow", () => {
  assert.deepEqual(afterAnswer(1, true, "2026-10-19"), { box: 2, dueOn: "2026-10-21", status: "active" })
  assert.deepEqual(afterAnswer(4, true, "2026-10-19"), { box: 5, dueOn: "2026-11-04", status: "active" })
  assert.deepEqual(afterAnswer(5, true, "2026-10-19"), { box: 5, dueOn: "2026-10-19", status: "learned" })
  assert.deepEqual(afterAnswer(4, false, "2026-10-19"), { box: 1, dueOn: "2026-10-20", status: "active" })
})

test("a card answered right every time it comes is learned on its fifth answer, a month on", () => {
  let card = { box: 1, dueOn: "2026-10-19", status: "active" }
  const asked = []
  while (card.status === "active") { asked.push(card.dueOn); card = afterAnswer(card.box, true, card.dueOn) }
  assert.deepEqual(asked, ["2026-10-19", "2026-10-21", "2026-10-25", "2026-11-02", "2026-11-18"])
})

test("the evening run is due from 21:00, once", () => {
  assert.equal(eveningDue(at("2026-10-19", 20, 59), "2026-10-18"), null)
  assert.equal(eveningDue(at("2026-10-19", 21, 0), "2026-10-18"), "2026-10-19")
  assert.equal(eveningDue(at("2026-10-19", 23, 30), "2026-10-19"), null)
  assert.equal(eveningDue(at("2026-10-20", 8), "2026-10-19"), null)
})

test("an evening missed (server off, Mac asleep) runs when the server is back; days missed run once, as the latest", () => {
  assert.equal(eveningDue(at("2026-10-20", 8), "2026-10-18"), "2026-10-19")
  assert.equal(eveningDue(at("2026-10-23", 8), "2026-10-18"), "2026-10-22")
  assert.equal(eveningDue(at("2026-10-23", 22), "2026-10-18"), "2026-10-23")
})

test("before any evening run nothing was missed: the first is the next 21:00", () => {
  assert.equal(eveningDue(at("2026-10-19", 14), null), null)
  assert.equal(eveningDue(at("2026-10-19", 21, 5), null), "2026-10-19")
})

test("a failed evening is tried again ten minutes on, three times in all", () => {
  const failed = at("2026-10-19", 21)
  const later = (ms) => new Date(failed.getTime() + ms)
  assert.equal(retryAllowed(0, null, failed), true)
  assert.equal(retryAllowed(1, failed, later(RETRY_MS - 1)), false)
  assert.equal(retryAllowed(1, failed, later(RETRY_MS)), true)
  assert.equal(retryAllowed(2, failed, later(RETRY_MS)), true)
  assert.equal(retryAllowed(3, failed, later(10 * RETRY_MS)), false)
})
