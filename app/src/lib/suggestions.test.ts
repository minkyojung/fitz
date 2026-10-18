import assert from "node:assert/strict"
import { test } from "node:test"

import { findOnce, placeSuggestions, within } from "./suggestions.ts"

test("findOnce: where the quote is, only when it is there exactly once", () => {
  assert.equal(findOnce("in a reserved way", "reserved"), 5)
  assert.equal(findOnce("reserved; reserve all", "reserve"), -1)
  assert.equal(findOnce("aaa", "aa"), -1)
  assert.equal(findOnce("abc", "x"), -1)
  assert.equal(findOnce("abc", ""), -1)
})

test("suggestions are laid in text order; one that no longer fits, or overlaps an earlier one, is not", () => {
  const text = "The abnormal rnind is quick, and unjust1y so."
  const s = (quote: string) => ({ quote })
  const placed = placeSuggestions(text, [s("unjust1y"), s("rnind"), s("gone"), s("rnind is"), s("is")])
  assert.deepEqual(placed.map((p) => [p.item.quote, p.start, p.end]), [["rnind", 13, 18], ["is", 19, 21], ["unjust1y", 33, 41]])
})

test("within: the ones inside a block of a paragraph shown block by block, from the block's start; one across blocks is in neither", () => {
  const text = "하나 둘\n셋 넷 다섯"
  const placed = placeSuggestions(text, [{ quote: "하나" }, { quote: "둘\n셋" }, { quote: "다섯" }])
  assert.equal(placed.length, 3)
  assert.deepEqual(within(placed, 0, 4).map((p) => [p.item.quote, p.start]), [["하나", 0]])
  assert.deepEqual(within(placed, 5, text.length).map((p) => [p.item.quote, p.start]), [["다섯", 4]])
})
