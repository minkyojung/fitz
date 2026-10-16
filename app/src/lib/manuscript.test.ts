import assert from "node:assert/strict"
import { test } from "node:test"

import { charCount, formatSheets, sheets } from "./manuscript.ts"

test("counts characters including spaces and punctuation, by code point", () => {
  assert.equal(charCount("샘 제무레이는 1893년에."), 15)
  assert.equal(charCount("a\nb"), 2)
})

test("200 characters make one sheet; partial sheets keep one decimal", () => {
  assert.equal(sheets("가".repeat(200)), 1)
  assert.equal(sheets("가".repeat(250)), 1.3)
  assert.equal(sheets(""), 0)
  assert.equal(formatSheets(1480.5), "1,480.5 sheets")
})
