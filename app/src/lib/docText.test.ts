import assert from "node:assert/strict"
import { test } from "node:test"

import { docPlainText, replaceRangeInDoc } from "./docText.ts"

const doc = { type: "doc" as const, content: [{ type: "paragraph" as const, content: [
  { type: "text" as const, text: "he " }, { type: "text" as const, text: "cleafed", marks: [{ type: "italic" }] }, { type: "text" as const, text: " the jungle" },
] }] }

test("replaces a range inside one node and keeps its marks", () => {
  const r = replaceRangeInDoc(doc, 3, 10, "cleared")
  assert.equal(docPlainText(r), "he cleared the jungle")
  assert.deepEqual(r.content[0].content![1].marks, [{ type: "italic" }])
})

test("replaces a range spanning nodes", () => {
  const r = replaceRangeInDoc(doc, 0, 10, "She cleared")
  assert.equal(docPlainText(r), "She cleared the jungle")
})

test("replaces at the very end and with an empty string", () => {
  assert.equal(docPlainText(replaceRangeInDoc(doc, 15, 21, "forest")), "he cleafed the forest")
  assert.equal(docPlainText(replaceRangeInDoc(doc, 2, 10, "")), "he the jungle")
})
