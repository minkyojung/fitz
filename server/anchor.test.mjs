import assert from "node:assert/strict"
import { test } from "node:test"

import { locateAnchor, makeAnchor } from "./anchor.mjs"

const text = "He offered a wage ten times the going rate, which angered other employers. Ten times, they said."

test("an anchor relocates at its offsets when the text is unchanged", () => {
  const a = makeAnchor(text, 18, 42)
  assert.equal(a.exact, "ten times the going rate")
  assert.deepEqual(locateAnchor(text, a), { start: 18, end: 42 })
})

test("after an edit before the quote, context picks the right occurrence", () => {
  const a = makeAnchor(text, 18, 27) // "ten times" (first)
  const edited = "He had offered a wage ten times the going rate, which angered other employers. Ten times, they said."
  assert.deepEqual(locateAnchor(edited, a), { start: 22, end: 31 })
  const second = makeAnchor(text, text.indexOf("Ten times"), text.indexOf("Ten times") + 9)
  assert.equal(locateAnchor(edited, second)?.start, edited.indexOf("Ten times"))
})

test("a quote that no longer exists yields null", () => {
  const a = makeAnchor(text, 18, 42)
  assert.equal(locateAnchor("Something else entirely.", a), null)
})
