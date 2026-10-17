import assert from "node:assert/strict"
import { test } from "node:test"

import { footnoteMarkers } from "./footnotes.ts"

test("author notes count up in reading order; translator notes are asterisks; unplaced notes get nothing", () => {
  const m = footnoteMarkers([
    { id: 3, kind: "author", segmentIdx: 2, start: 5 },
    { id: 1, kind: "translator", segmentIdx: 1, start: 0 },
    { id: 2, kind: "author", segmentIdx: 1, start: 9 },
    { id: 4, kind: "author", segmentIdx: 3, start: null },
  ])
  assert.deepEqual([...m], [[1, "*"], [2, "1"], [3, "2"]])
})
