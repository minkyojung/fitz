import assert from "node:assert/strict"
import { test } from "node:test"

import { footnoteMarkers } from "./footnotes.ts"

test("author notes count up in reading order; translator notes are asterisks; an unplaced note counts at its paragraph's end", () => {
  const m = footnoteMarkers([
    { id: 3, kind: "author", segmentIdx: 2, start: 5 },
    { id: 1, kind: "translator", segmentIdx: 1, start: 0 },
    { id: 2, kind: "author", segmentIdx: 1, start: 9 },
    { id: 5, kind: "author", segmentIdx: 2, start: null },
    { id: 4, kind: "author", segmentIdx: 3, start: null },
  ])
  assert.deepEqual([...m].sort((a, b) => a[0] - b[0]), [[1, "*"], [2, "1"], [3, "2"], [4, "4"], [5, "3"]])
})

test("placing a note earlier in its paragraph moves it ahead of a placed later one", () => {
  const before = footnoteMarkers([{ id: 1, kind: "author", segmentIdx: 0, start: 20 }, { id: 2, kind: "author", segmentIdx: 0, start: null }])
  const after = footnoteMarkers([{ id: 1, kind: "author", segmentIdx: 0, start: 20 }, { id: 2, kind: "author", segmentIdx: 0, start: 3 }])
  assert.deepEqual([before.get(1), before.get(2)], ["1", "2"])
  assert.deepEqual([after.get(1), after.get(2)], ["2", "1"])
})
