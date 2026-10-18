import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"

import { emptyConversation, foldMessages, type SdkMessage } from "../../../server/agent/fold.mjs"

// The page folds a conversation with the server's own fold (docs/agent.md §17): a snapshot the server sends, then the
// messages after it, must end where the server's fold of everything ends — whatever the moment the page joined.
const recording = (name: string): SdkMessage[] =>
  readFileSync(new URL(`../../../server/agent/fixtures/${name}.jsonl`, import.meta.url), "utf8").trim().split("\n").map((l) => JSON.parse(l))

for (const name of ["nuance", "translate", "review", "typos"]) {
  test(`${name}: joined at any moment, the page ends where the server does`, () => {
    const frames = recording(name)
    const all = foldMessages(frames)
    for (const cut of [0, 1, Math.floor(frames.length / 3), Math.floor(frames.length / 2), frames.length - 1]) {
      const snapshot = JSON.parse(JSON.stringify(foldMessages(frames.slice(0, cut))))  // as it crosses the socket
      assert.deepEqual(foldMessages(frames.slice(cut), snapshot), all, `cut at ${cut}`)
    }
    assert.equal(all.status, "idle")
    assert.equal(all.items.at(-1)?.kind, "turn")
  })
}

test("a new conversation is empty and idle", () => {
  assert.deepEqual(emptyConversation(), { sessionId: null, model: null, status: "idle", items: [], live: null, spent: 0 })
})
