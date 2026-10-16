import assert from "node:assert/strict"
import { test } from "node:test"

import { findSuspects } from "./spell.ts"

const dict = new Set(["he", "cleared", "the", "jungle", "it", "was", "a", "banana", "man", "sam", "new", "orleans", "in"])
const correct = (w: string) => dict.has(w.toLowerCase())

test("flags words the dictionary cannot form, with positions", () => {
  const s = findSuspects("he cleafed the jungle", correct)
  assert.deepEqual(s, [{ start: 3, end: 10, word: "cleafed" }])
})

test("skips acronyms, numbers, single letters and user words", () => {
  assert.deepEqual(findSuspects("In 1910 the USA man", correct), [])
  assert.deepEqual(findSuspects("Sam Zemurray was a banana man", correct, new Set(["Zemurray"])), [])
  assert.equal(findSuspects("Sam Zemurray was a banana man", correct).length, 1)
})

test("sentence-initial capitals are fine when the lowercase form is a word; apostrophes stay inside words", () => {
  assert.deepEqual(findSuspects("The jungle", correct), [])
  assert.deepEqual(findSuspects("It’s new", (w) => w === "It's" || dict.has(w.toLowerCase())), [])
})
