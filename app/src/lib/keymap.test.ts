// node --test --experimental-strip-types app/src/lib/keymap.test.ts
import assert from "node:assert/strict"
import { test } from "node:test"

import { chordLabel, commandFor, isTypingTarget } from "./keymap.ts"

const ev = (key: string, mods: Partial<{ metaKey: boolean; ctrlKey: boolean; shiftKey: boolean }> = {}) => ({
  key, metaKey: false, ctrlKey: false, shiftKey: false, ...mods,
})

test("plain keys map to navigation and actions", () => {
  assert.equal(commandFor(ev("ArrowDown")), "selectNext")
  assert.equal(commandFor(ev("j")), "selectNext")
  assert.equal(commandFor(ev("K")), "selectPrev")
  assert.equal(commandFor(ev(" ")), "toggleVerified")
  assert.equal(commandFor(ev("Enter")), "startEdit")
  assert.equal(commandFor(ev("Escape")), "cancelEdit")
})

test("modifier chords: cmd+z undo, cmd+shift+z redo, ctrl counts as meta", () => {
  assert.equal(commandFor(ev("z", { metaKey: true })), "undo")
  assert.equal(commandFor(ev("z", { ctrlKey: true })), "undo")
  assert.equal(commandFor(ev("z", { metaKey: true, shiftKey: true })), "redo")
  assert.equal(commandFor(ev("Z", { metaKey: true, shiftKey: true })), "redo")
})

test("unrelated keys and wrong modifiers map to nothing", () => {
  assert.equal(commandFor(ev("x")), null)
  assert.equal(commandFor(ev("j", { metaKey: true })), null)
  assert.equal(commandFor(ev("ArrowDown", { shiftKey: true })), null)
})

test("typing targets suppress global shortcuts", () => {
  assert.equal(isTypingTarget({ tagName: "TEXTAREA" }), true)
  assert.equal(isTypingTarget({ tagName: "INPUT" }), true)
  assert.equal(isTypingTarget({ tagName: "DIV", isContentEditable: true }), true)
  assert.equal(isTypingTarget({ tagName: "DIV" }), false)
  assert.equal(isTypingTarget(null), false)
})

test("labels", () => {
  assert.equal(chordLabel({ key: "z", meta: true, shift: true }), "⌘⇧Z")
  assert.equal(chordLabel({ key: " " }), "Space")
  assert.equal(chordLabel({ key: "ArrowDown" }), "↓")
})
