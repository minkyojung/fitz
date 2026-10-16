import assert from "node:assert/strict"
import { test } from "node:test"

import { chapterForPage } from "./pages.ts"

const chapters = [
  { id: 1, startPage: 3 },
  { id: 2, startPage: 11 },
  { id: 3, startPage: 17 },
  { id: 9, startPage: null },
]

test("a page maps to the chapter whose range contains it", () => {
  assert.equal(chapterForPage(chapters, 3), 1)
  assert.equal(chapterForPage(chapters, 10), 1)
  assert.equal(chapterForPage(chapters, 11), 2)
  assert.equal(chapterForPage(chapters, 16), 2)
  assert.equal(chapterForPage(chapters, 17), 3)
  assert.equal(chapterForPage(chapters, 300), 3)
})

test("front matter before the first chapter has no chapter", () => {
  assert.equal(chapterForPage(chapters, 1), null)
  assert.equal(chapterForPage([], 5), null)
})

test("order of input does not matter", () => {
  assert.equal(chapterForPage([...chapters].reverse(), 12), 2)
})
