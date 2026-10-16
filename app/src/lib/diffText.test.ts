import assert from "node:assert/strict"
import { test } from "node:test"

import { diffText, isChanged } from "./diffText.ts"

test("identical text has no changed pieces", () => {
  assert.equal(isChanged(diffText("a b c", "a b c")), false)
})

test("a one-letter fix is a single replaced word", () => {
  const p = diffText("he cleafed the", "he cleared the")
  assert.deepEqual(p.map((x) => [x.kind, x.text]), [["same", "he "], ["removed", "cleafed"], ["added", "cleared"], ["same", " the"]])
})

test("highlights hug words: no whitespace inside changed pieces", () => {
  const p = diffText("known by a variety of nicknames: Z", "known by many names: Z")
  for (const x of p) if (x.kind !== "same") assert.equal(x.text, x.text.trim(), JSON.stringify(x))
  // same + added pieces rebuild the current text; same + removed rebuild the original
  assert.equal(p.filter((x) => x.kind !== "removed").map((x) => x.text).join(""), "known by many names: Z")
  assert.equal(p.filter((x) => x.kind !== "added").map((x) => x.text).join(""), "known by a variety of nicknames: Z")
})
