import assert from "node:assert/strict"
import { test } from "node:test"

import { createDraftStore } from "./draftStore.ts"

const memory = () => {
  const m = new Map<string, string>()
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    key: (i: number) => [...m.keys()][i] ?? null,
    get length() { return m.size },
  }
}
const doc = (text: string) => ({ type: "doc" as const, content: [{ type: "paragraph" as const, content: [{ type: "text" as const, text }] }] })

test("save, load, clear round-trip under a book-scoped key", () => {
  const store = memory()
  const drafts = createDraftStore(store, 7)
  drafts.save(42, doc("hello"), "hell")
  assert.equal(store.key(0), "draft:7:42")
  assert.deepEqual(drafts.load(42)?.doc, doc("hello"))
  assert.equal(drafts.load(42)?.baseText, "hell")
  drafts.clear(42)
  assert.equal(drafts.load(42), null)
})

test("ids lists drafts for this book only", () => {
  const store = memory()
  createDraftStore(store, 1).save(5, doc("a"), "a")
  createDraftStore(store, 2).save(6, doc("b"), "b")
  assert.deepEqual(createDraftStore(store, 1).ids(), [5])
})

test("corrupt entries are dropped instead of thrown", () => {
  const store = memory()
  store.setItem("draft:1:9", "{not json")
  const drafts = createDraftStore(store, 1)
  assert.equal(drafts.load(9), null)
  assert.equal(drafts.ids().length, 0)
})
