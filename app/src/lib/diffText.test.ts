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

test("Korean is compared word by word, not letter by letter", () => {
  const p = diffText("그래서 나는 모든 판단을 유보하는 버릇이 생겼는데", "그래서 나는 섣불리 판단하지 않는 버릇이 생겼는데")
  assert.deepEqual(p.map((x) => [x.kind, x.text]), [
    ["same", "그래서 나는 "], ["removed", "모든 판단을 유보하는"], ["added", "섣불리 판단하지 않는"], ["same", " 버릇이 생겼는데"],
  ])
})
