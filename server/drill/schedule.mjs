// Session's rules of time (docs/session.md §4–5), pure: the server's local days, the boxes, when the evening run is
// due. Days are 'YYYY-MM-DD' in the server's local time zone — SQLite's datetime('now') is UTC, and a translator in
// Seoul working at eight in the morning is working today, not yesterday.

/** Days until a card in each box is asked again. Right the fifth time, in box 5, a card is learned. */
export const INTERVAL = { 1: 1, 2: 2, 3: 4, 4: 8, 5: 16 }
/** The evening run's hour, local. */
export const EVENING_HOUR = 21
/** A failed evening run is tried again this much later, this many times in all; then it waits for the translator. */
export const RETRY_MS = 10 * 60_000
export const TRIES = 3

const pad = (n) => String(n).padStart(2, "0")

/** The local day of a moment. */
export const dayOf = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`

/** The day `n` days after `day` (before, if negative): calendar arithmetic, untouched by clocks and time zones. */
export function addDays(day, n) {
  const [y, m, d] = day.split("-").map(Number)
  const t = new Date(Date.UTC(y, m - 1, d + n))
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`
}

/** Where a card goes after the day's first answer to it: right, up a box (or learned from box 5); wrong, box 1 and
 *  tomorrow. Answers after the first that day are practice and move nothing. */
export function afterAnswer(box, correct, today) {
  if (!correct) return { box: 1, dueOn: addDays(today, INTERVAL[1]), status: "active" }
  if (box === 5) return { box: 5, dueOn: today, status: "learned" }
  return { box: box + 1, dueOn: addDays(today, INTERVAL[box + 1]), status: "active" }
}

/** The evening whose run is due at `now`, or null. It is the latest 21:00 at or before now, unless a run has finished
 *  for it (`lastDone`, the latest evening run done). Evenings missed while the server was off or the Mac asleep are
 *  not run one by one: the latest stands for them, its material reaching back to the last run's. Before any evening
 *  run at all, nothing was missed: the first is the next 21:00. */
export function eveningDue(now, lastDone) {
  const today = dayOf(now)
  const afterHour = now.getHours() >= EVENING_HOUR
  if (lastDone === null) return afterHour ? today : null
  const latest = afterHour ? today : addDays(today, -1)
  return lastDone >= latest ? null : latest
}

/** Whether an evening that failed `failures` times, the last at `lastFailedAt`, is tried again at `now`. */
export const retryAllowed = (failures, lastFailedAt, now) =>
  failures === 0 || (failures < TRIES && now.getTime() - lastFailedAt.getTime() >= RETRY_MS)
