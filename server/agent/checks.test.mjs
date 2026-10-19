import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import { DatabaseSync } from "node:sqlite"

import { execute, pmDoc } from "../commands.mjs"
import { makeAnchor } from "../anchor.mjs"
import { checkSegments, reasonFor } from "./checks.mjs"

function gatsby() {
  const db = new DatabaseSync(":memory:")
  db.exec(readFileSync(new URL("../../db/schema.sql", import.meta.url), "utf8"))
  db.exec(readFileSync(new URL("./fixtures/gatsby.sql", import.meta.url), "utf8"))
  return db
}
const translate = (db, id, text) => execute(db, "updateSegment", { id, targetDoc: JSON.parse(pmDoc(text)) })
const term = (db, term, translation, aliases = "") => execute(db, "setGlossaryTerm", { bookId: 1, term, translation, aliases })

test("a glossary term in the source needs one of its agreed forms in the translation", () => {
  const db = gatsby()
  term(db, "advantages", "혜택", "좋은 조건")
  term(db, "criticizing", "")  // no translation agreed yet: not checked
  translate(db, 3, "“누군가를 비판하고 싶어질 때면,” 아버지는 말씀하셨다. “세상 사람들이 다 너만큼 유리한 처지는 아니란다.”")
  assert.deepEqual(checkSegments(db, [3]), [{ segmentId: 3, kind: "term", term: "advantages", forms: ["혜택", "좋은 조건"] }])
  translate(db, 3, "“…” 아버지는 말씀하셨다. “세상 사람들이 다 너처럼 좋은 조건을 누린 건 아니란다.”")
  assert.deepEqual(checkSegments(db, [3]), [], "an alias will do")
})

test("the term is found as the editor finds it: whole word, any case, with a plural or possessive tail", () => {
  const db = gatsby()
  term(db, "judgment", "판단")
  translate(db, 4, "그래서 나는 모든 것을 미루는 버릇이 생겼다.")
  assert.deepEqual(checkSegments(db, [4]).map((f) => f.term), ["judgment"], "“judgments” in the source counts")
  term(db, "judg", "X")
  assert.deepEqual(checkSegments(db, [4]).map((f) => f.term), ["judgment"], "a part of a word does not")
})

test("a note whose place in the translation is gone fails; a note never placed is not Claude's to place", () => {
  const db = gatsby()
  translate(db, 4, "아버지는 말을 아끼셨다. 그래서 나는 모든 판단을 유보하는 버릇이 생겼다.")
  const text = "아버지는 말을 아끼셨다. 그래서 나는 모든 판단을 유보하는 버릇이 생겼다."
  const at = text.indexOf("유보하는")
  const placed = execute(db, "addNote", { segmentId: 4, anchor: makeAnchor(text, at, at + 4), body: "역주" })
  db.prepare("INSERT INTO note(id, segment_id, kind, src_exact, src_start, src_end, anchored) VALUES (90, 4, 'author', 'reserved', 79, 87, 1)").run()
  assert.deepEqual(checkSegments(db, [4]), [], "placed and still there; the author's note was never placed")
  translate(db, 4, "아버지는 말을 아끼셨다. 그래서 나는 섣불리 판단하지 않는 버릇이 생겼다.")
  assert.deepEqual(checkSegments(db, [4]), [{ segmentId: 4, kind: "note", noteId: placed.id, noteKind: "translator", quote: "유보하는" }])
})

test("only the paragraphs asked about, each once; a paragraph with no translation has nothing to check", () => {
  const db = gatsby()
  term(db, "father", "아버지")
  translate(db, 2, "젊고 여렸던 시절, 아빠가 해 준 충고가 있다.")
  assert.equal(checkSegments(db, [2, 2]).length, 1)
  assert.deepEqual(checkSegments(db, [5]), [], "¶5 has no translation")
  assert.deepEqual(checkSegments(db, []), [])
})

test("the failures as Claude is told them: where, what, and what makes it right — or leave to say it is right", () => {
  const reason = reasonFor([
    { segmentId: 3, kind: "term", term: "Zemurray", forms: ["제머리", "샘 제머리"] },
    { segmentId: 4, kind: "note", noteId: 7, noteKind: "author", quote: "유보하는" },
  ])
  assert.equal(reason, [
    "fitz checked the translations you wrote this turn and found:",
    "- ¶3: the source has “Zemurray”; the glossary's agreed form is “제머리” (also accepted: 샘 제머리), and the translation has none of them.",
    "- ¶4: the author's note 7 was placed after “유보하는” in the translation, and those words are gone. Keep them, so the note keeps its place.",
    "Fix these with set_translation (read the paragraph again for its version), then stop. If one is right as it is (a term used in another sense, or the wording the translator asked you for), leave it, say why in one line and stop.",
  ].join("\n"))
})
