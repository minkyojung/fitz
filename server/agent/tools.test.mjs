import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import { DatabaseSync } from "node:sqlite"

import { pmDoc, undo, watchChanges } from "../commands.mjs"
import { checkSegments } from "./checks.mjs"
import { READ_BUDGET, addComment, addTranslatorNote, book, describeWrite, editTranslation, fitzServer, fitzTools, glossary, read, readTools, searchBook, setGlossaryTerm, setNote, setTranslation, writeTools } from "./tools.mjs"

const SCHEMA = readFileSync(new URL("../../db/schema.sql", import.meta.url), "utf8")
const plain = (v) => JSON.parse(JSON.stringify(v))
const sql = (s) => s.replace(/'/g, "''")

function fixture() {
  const db = new DatabaseSync(":memory:")
  db.exec(SCHEMA)
  db.exec(`
    INSERT INTO book(id, title, author, source_pdf) VALUES (1, 'The Fish', 'Cohen', '/secret/book.pdf');
    INSERT INTO page(book_id, page_no, pdf_index, image_path) VALUES (1, 3, 2, '/secret/pages/p003.png');
    INSERT INTO chapter(id, book_id, idx, title, start_page) VALUES (1, 1, 0, 'One', 3), (2, 1, 1, 'Two', 9);
    INSERT INTO segment(id, chapter_id, idx, kind, page_start, page_end, ocr_text, source_doc, source_text, target_doc, target_text, status)
      VALUES (1, 1, 0, 'heading',   3, 3, 'One', '${pmDoc("One")}', 'One', '${pmDoc("하나")}', '하나', 'reviewed'),
             (2, 1, 1, 'paragraph', 3, 4, 'Zemurray''s boat', '${sql(pmDoc("Zemurray's boat"))}', 'Zemurray''s boat', NULL, NULL, 'untranslated'),
             (3, 1, 2, 'paragraph', 4, 4, 'bananas', '${pmDoc("bananas")}', 'bananas', '${pmDoc("바나나")}', '바나나', 'draft'),
             (4, 1, 3, 'paragraph', 5, 5, 'last', '${pmDoc("last")}', 'last', NULL, NULL, 'untranslated'),
             (5, 2, 0, 'paragraph', 9, 9, 'Zemurrays everywhere', '${pmDoc("Zemurrays everywhere")}', 'Zemurrays everywhere', NULL, NULL, 'untranslated');
    INSERT INTO segment_box(segment_id, page_no, x0, y0, x1, y1) VALUES (2, 3, 0.1, 0.5, 0.9, 0.9);
    INSERT INTO glossary(book_id, term, translation, aliases, kind) VALUES (1, 'Zemurray', '제무레이', '샘 제무레이', 'person'), (1, 'boat', '', NULL, 'other');
    INSERT INTO note(id, segment_id, kind, src_exact, src_start, src_end, orig_page, orig_quote, body_source, body_target, anchored)
      VALUES (1, 2, 'author', 'boat', 11, 15, 3, 'boat', 'Bought in 1903.', '1903년에 샀다.', 1);
    INSERT INTO note(id, segment_id, kind, tgt_exact, body_target, anchored) VALUES (2, 3, 'translator', '바나나', '열대 과일.', 0);
    INSERT INTO comment(id, segment_id, side, src_exact, body) VALUES (1, 2, 'source', 'boat', 'which boat?');
  `)
  return db
}

test("book: title, author and chapters with progress, nothing else", () => {
  assert.deepEqual(plain(book(fixture())), {
    id: 1, title: "The Fish", author: "Cohen",
    chapters: [
      { id: 1, idx: 0, title: "One", startPage: 3, segmentCount: 4, confirmedCount: 1 },
      { id: 2, idx: 1, title: "Two", startPage: 9, segmentCount: 1, confirmedCount: 0 },
    ],
  })
})

test("read: a paragraph carries its notes, comments and the terms it mentions", () => {
  const { segments, next } = read(fixture(), { ids: [2] })
  assert.equal(next, undefined)
  const s = plain(segments[0])
  assert.equal(typeof s.version, "number")
  delete s.version
  assert.deepEqual(s, {
    id: 2, chapterId: 1, idx: 1, kind: "paragraph", pageStart: 3, pageEnd: 4, status: "untranslated",
    sourceText: "Zemurray's boat", targetText: "",
    notes: [{ id: 1, kind: "author", text: "Bought in 1903.", translation: "1903년에 샀다.", quote: "boat", placedAfter: null }],
    comments: [{ id: 1, parentId: null, side: "source", author: "translator", body: "which boat?", resolved: false, quote: "boat" }],
    terms: [
      { term: "Zemurray", translation: "제무레이", aliases: "샘 제무레이", kind: "person" },
      { term: "boat", translation: "", aliases: "", kind: "other" },
    ],
  })
})

test("read: a translator's note shows its own text and where it sits in the translation", () => {
  const [s] = read(fixture(), { ids: [3] }).segments
  assert.deepEqual(plain(s.notes), [{ id: 2, kind: "translator", text: "열대 과일.", quote: "바나나" }])
  assert.equal(s.targetText, "바나나")
})

test("read: terms match the app's rule — plural and possessive tails, whole words only", () => {
  const [s] = read(fixture(), { ids: [5] }).segments
  assert.deepEqual(s.terms.map((t) => t.term), ["Zemurray"])
})

test("read: ids come back in book order whatever order they were asked in", () => {
  assert.deepEqual(read(fixture(), { ids: [5, 1, 3] }).segments.map((s) => s.id), [1, 3, 5])
})

test("read: around widens one id within its chapter and stops at the chapter's edges", () => {
  const db = fixture()
  assert.deepEqual(read(db, { ids: [3], around: 1 }).segments.map((s) => s.id), [2, 3, 4])
  assert.deepEqual(read(db, { ids: [1], around: 2 }).segments.map((s) => s.id), [1, 2, 3])
  assert.deepEqual(read(db, { ids: [5], around: 3 }).segments.map((s) => s.id), [5])
})

test("read: a chapter in order, and from continues it", () => {
  const db = fixture()
  assert.deepEqual(read(db, { chapterId: 1 }).segments.map((s) => s.id), [1, 2, 3, 4])
  assert.deepEqual(read(db, { chapterId: 1, from: 2 }).segments.map((s) => s.id), [3, 4])
})

test("read: past the budget it stops and next continues exactly where it stopped", () => {
  const db = fixture()
  // two paragraphs of half the budget each: their notes and comments count too, so the pair does not fit
  const long = "x".repeat(READ_BUDGET / 2)
  db.prepare("UPDATE segment SET source_text = ? WHERE id IN (2, 3)").run(long)
  const first = read(db, { chapterId: 1 })
  assert.deepEqual(first.segments.map((s) => s.id), [1, 2])
  assert.deepEqual(first.next, { chapterId: 1, from: 2 })
  const second = read(db, first.next)
  assert.deepEqual(second.segments.map((s) => s.id), [3, 4])
  assert.equal(second.next, undefined)
  const byIds = read(db, { ids: [2, 3, 4] })
  assert.deepEqual(byIds.segments.map((s) => s.id), [2])
  assert.deepEqual(byIds.next, { ids: [3, 4] })
})

test("read: one paragraph over the budget still comes back alone", () => {
  const db = fixture()
  db.prepare("UPDATE segment SET source_text = ? WHERE id = 1").run("x".repeat(READ_BUDGET * 2))
  const r = read(db, { chapterId: 1 })
  assert.deepEqual(r.segments.map((s) => s.id), [1])
  assert.deepEqual(r.next, { chapterId: 1, from: 1 })
})

test("read: refuses arguments that do not say one thing", () => {
  const db = fixture()
  assert.throws(() => read(db, {}), /either ids or chapterId/)
  assert.throws(() => read(db, { ids: [1], chapterId: 1 }), /either ids or chapterId/)
  assert.throws(() => read(db, { ids: [1, 2], around: 1 }), /around needs exactly one id/)
  assert.throws(() => read(db, { ids: [1], from: 1 }), /from goes with chapterId/)
  assert.throws(() => read(db, { ids: [1, 99] }), { status: 404, message: "segment 99 not found" })
  assert.throws(() => read(db, { chapterId: 9 }), { status: 404, message: "chapter 9 not found" })
})

test("glossary and search", () => {
  const db = fixture()
  assert.deepEqual(plain(glossary(db)), { terms: [
    { term: "boat", translation: "", aliases: "", kind: "other", occurrences: 1 },
    { term: "Zemurray", translation: "제무레이", aliases: "샘 제무레이", kind: "person", occurrences: 1 },
  ] })
  assert.deepEqual(searchBook(db, { query: "banana" }).hits.map((h) => [h.segmentId, h.count]), [[3, 1]])
})

// The contract: only text leaves. No page images, no PDF path, no page boxes, no OCR original, no editor JSON.
const FORBIDDEN_KEYS = ["image_path", "imagePath", "imageUrl", "source_pdf", "sourcePdf", "boxes", "ocrText", "ocr_text", "sourceDoc", "targetDoc", "source_doc", "target_doc"]
const keysDeep = (v) => (v && typeof v === "object" ? Object.entries(v).flatMap(([k, x]) => [k, ...keysDeep(x)]) : [])

test("no read tool result carries a page image, the PDF, page boxes, the OCR original or editor JSON", async () => {
  const db = fixture()
  const outputs = [book(db), read(db, { chapterId: 1 }), read(db, { chapterId: 2 }), read(db, { ids: [2], around: 3 }), glossary(db), searchBook(db, { query: "Zemurray" })]
  for (const t of readTools(db)) outputs.push((await t.handler(t.name === "read" ? { chapterId: 1 } : t.name === "search" ? { query: "a" } : {}, {})).structuredContent)
  for (const out of outputs) {
    const keys = keysDeep(out)
    assert.deepEqual(keys.filter((k) => FORBIDDEN_KEYS.includes(k)), [])
    const text = JSON.stringify(out)
    assert.ok(!/\/secret\/|\.png|\.pdf/.test(text), text)
  }
})

test("MCP: four read-only tools whose results are the functions' results as JSON", async () => {
  const db = fixture()
  const tools = readTools(db)
  assert.deepEqual(tools.map((t) => t.name), ["book", "read", "glossary", "search"])
  for (const t of tools) assert.equal(t.annotations?.readOnlyHint, true, t.name)
  const r = await tools[1].handler({ ids: [3], around: 1 }, {})
  assert.deepEqual(plain(r.structuredContent), plain(read(db, { ids: [3], around: 1 })))
  assert.deepEqual(JSON.parse(r.content[0].text), plain(r.structuredContent))
  await assert.rejects(tools[1].handler({ ids: [99] }, {}), /segment 99 not found/)
})

test("a task's server offers the read tools only; a free conversation's, the writes too", () => {
  const db = fixture()
  assert.deepEqual(fitzTools(db, { write: false }).map((t) => t.name), ["book", "read", "glossary", "search"])
  assert.deepEqual(fitzTools(db).map((t) => t.name), ["book", "read", "glossary", "search", "set_translation", "edit_translation", "set_glossary_term", "add_comment", "add_translator_note", "set_note"])
})

test("MCP: the server is in-process, named fitz, and keeps its tools loaded", () => {
  const server = fitzServer(fixture())
  assert.equal(server.type, "sdk")
  assert.equal(server.name, "fitz")
  assert.ok(server.instance)
})

// --- writes: every one goes through execute(), so it can be taken back (as Claude's: ⌘Z is the translator's own)

const seg = (db, id) => db.prepare("SELECT target_text, target_doc, status, version FROM segment WHERE id = ?").get(id)
const versionOf = (db, id) => read(db, { ids: [id] }).segments[0].version

test("set_translation writes the paragraph as draft, one block per line, and undoing it takes it back", () => {
  const db = fixture()
  const before = versionOf(db, 2)
  const out = setTranslation(db, { segmentId: 2, text: "제무레이의 배.\n\n  두 번째 블록  ", expectVersion: before })
  assert.deepEqual(out, { segmentId: 2, status: "draft", version: seg(db, 2).version, targetText: "제무레이의 배.\n두 번째 블록" })
  assert.ok(out.version > before)
  assert.equal(JSON.parse(seg(db, 2).target_doc).content.length, 2)
  assert.deepEqual(plain(undo(db, { actor: "agent" })), { id: 1, name: "updateSegment", segmentIds: [2], actor: "agent" })
  assert.deepEqual({ ...seg(db, 2), version: null }, { target_text: null, target_doc: null, status: "untranslated", version: null })
})

test("set_translation over a reviewed paragraph makes it draft again: confirming is the translator's", () => {
  const db = fixture()
  setTranslation(db, { segmentId: 1, text: "제1장", expectVersion: versionOf(db, 1) })
  assert.equal(seg(db, 1).status, "draft")
})

test("set_translation is refused when the paragraph changed since it was read, or when there is nothing to write", () => {
  const db = fixture()
  const read2 = versionOf(db, 2)
  db.prepare("UPDATE segment SET target_text = '번역자가 고침' WHERE id = 2").run()  // the translator saved meanwhile
  assert.throws(() => setTranslation(db, { segmentId: 2, text: "x", expectVersion: read2 }), { status: 409, message: /¶2 changed since you read it/ })
  assert.equal(seg(db, 2).target_text, "번역자가 고침")
  assert.throws(() => setTranslation(db, { segmentId: 2, text: " \n ", expectVersion: versionOf(db, 2) }), { status: 400, message: /empty/ })
  assert.throws(() => setTranslation(db, { segmentId: 99, text: "x", expectVersion: 0 }), { status: 404 })
})

test("edit_translation changes the quoted words only: the other blocks, italics and the words a note is placed at stay", () => {
  const db = fixture()
  const doc = { type: "doc", content: [
    { type: "paragraph", content: [{ type: "text", text: "노란 " }, { type: "text", text: "바나나", marks: [{ type: "italic" }] }, { type: "text", text: "를 샀다." }] },
    { type: "paragraph", content: [{ type: "text", text: "두 번째 블록." }] },
  ] }
  db.prepare("UPDATE segment SET target_doc = ?, target_text = ?, status = 'reviewed' WHERE id = 3").run(JSON.stringify(doc), "노란 바나나를 샀다.\n두 번째 블록.")
  const out = editTranslation(db, { segmentId: 3, quote: "노란", replacement: "초록", expectVersion: versionOf(db, 3) })
  assert.deepEqual(out, { segmentId: 3, status: "draft", version: seg(db, 3).version, targetText: "초록 바나나를 샀다.\n두 번째 블록." })
  const [first, second] = doc.content
  assert.deepEqual(JSON.parse(seg(db, 3).target_doc), { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "초록 " }, ...first.content.slice(1)] }, second] })
  assert.deepEqual(checkSegments(db, [3]), [], "the translator's note at 바나나 keeps its place")
  editTranslation(db, { segmentId: 3, quote: " 블록", replacement: "", expectVersion: versionOf(db, 3) })
  assert.equal(seg(db, 3).target_text, "초록 바나나를 샀다.\n두 번째.")
  undo(db, { actor: "agent" })
  undo(db, { actor: "agent" })
  assert.deepEqual([seg(db, 3).target_text, seg(db, 3).status], ["노란 바나나를 샀다.\n두 번째 블록.", "reviewed"])
})

test("edit_translation is refused, with nothing written, when it cannot change just those words", () => {
  const db = fixture()
  const doc = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "바나나 한 개." }] }, { type: "paragraph", content: [{ type: "text", text: "바나나 두 개." }] }] }
  db.prepare("UPDATE segment SET target_doc = ?, target_text = ? WHERE id = 3").run(JSON.stringify(doc), "바나나 한 개.\n바나나 두 개.")
  const v = versionOf(db, 3)
  const edit = (quote, replacement, expectVersion = v, segmentId = 3) => () => editTranslation(db, { segmentId, quote, replacement, expectVersion })
  assert.throws(edit("바나나", "사과"), { status: 400, message: /more than once/ })
  assert.throws(edit("포도", "사과"), { status: 400, message: /"포도" is not in the paragraph's translation/ })
  assert.throws(edit("개.\n바나나", "개. 바나나"), { status: 400, message: /within one block/ })
  assert.throws(edit("한 개", "한\n개"), { status: 400, message: /line break/ })
  assert.throws(edit("바나나 한 개.", " "), { status: 400, message: /empty a block/ })
  assert.throws(edit("포도", "사과", v - 1), { status: 409, message: /¶3 changed since you read it/ }, "the version is checked first")
  assert.throws(edit("boat", "배", versionOf(db, 2), 2), { status: 400, message: /no translation yet; write it with set_translation/ })
  assert.throws(edit("x", "y", 0, 99), { status: 404 })
  assert.equal(seg(db, 3).version, v)
  assert.equal(db.prepare("SELECT count(*) n FROM ops").get().n, 0)
})

test("set_glossary_term adds a term, changes one keeping what was not given, and undoing it takes it back", () => {
  const db = fixture()
  setGlossaryTerm(db, { term: "Selma", translation: "셀마", kind: "place" })
  setGlossaryTerm(db, { term: "Zemurray", translation: "제머리" })
  const terms = Object.fromEntries(glossary(db).terms.map((t) => [t.term, t]))
  assert.deepEqual([terms.Selma.translation, terms.Selma.kind], ["셀마", "place"])
  assert.deepEqual([terms.Zemurray.translation, terms.Zemurray.aliases, terms.Zemurray.kind], ["제머리", "샘 제무레이", "person"])
  undo(db, { actor: "agent" })
  undo(db, { actor: "agent" })
  assert.deepEqual(glossary(db).terms.map((t) => `${t.term}=${t.translation}`), ["boat=", "Zemurray=제무레이"])
})

test("add_comment is the agent's and pinned to the quoted words; read shows who wrote it", () => {
  const db = fixture()
  addComment(db, { segmentId: 2, side: "source", body: "누구의 배인지 확인 필요", quote: "boat" })
  const c = read(db, { ids: [2] }).segments[0].comments.at(-1)
  assert.deepEqual([c.author, c.body, c.quote, c.side], ["agent", "누구의 배인지 확인 필요", "boat", "source"])
  const row = db.prepare("SELECT src_start, src_end FROM comment WHERE id = ?").get(c.id)
  assert.deepEqual(plain(row), { src_start: 11, src_end: 15 })
  assert.throws(() => addComment(db, { segmentId: 2, side: "source", body: "x", quote: "ship" }), { status: 400, message: /"ship" is not in the paragraph's source/ })
  assert.throws(() => addComment(db, { segmentId: 3, side: "target", body: "x", quote: "나" }), { status: 400, message: /more than once/ })
})

test("add_translator_note is pinned in the translation, and needs one to be there", () => {
  const db = fixture()
  addTranslatorNote(db, { segmentId: 3, body: "남미산 품종.", quote: "바나나" })
  assert.deepEqual(read(db, { ids: [3] }).segments[0].notes.map((n) => [n.kind, n.text, n.quote]), [["translator", "열대 과일.", "바나나"], ["translator", "남미산 품종.", "바나나"]])
  assert.throws(() => addTranslatorNote(db, { segmentId: 2, body: "x", quote: "boat" }), { status: 400, message: /no translation yet/ })
})

test("set_note translates an author's note and places its number; the book's own text of it stays, and undoing takes it back", () => {
  const db = fixture()
  setTranslation(db, { segmentId: 2, text: "제무레이의 배", expectVersion: versionOf(db, 2) })
  const note = () => plain(read(db, { ids: [2] }).segments[0].notes[0])
  assert.equal(note().placedAfter, null)
  const out = setNote(db, { noteId: 1, body: "1903년에 샀다고 한다.", quote: "배" })
  assert.deepEqual(out, { id: 1, segmentId: 2, kind: "author", quote: "배" })
  assert.deepEqual(note(), { id: 1, kind: "author", text: "Bought in 1903.", translation: "1903년에 샀다고 한다.", quote: "boat", placedAfter: "배" })
  assert.deepEqual(plain(db.prepare("SELECT body_source, tgt_start, tgt_end FROM note WHERE id = 1").get()), { body_source: "Bought in 1903.", tgt_start: 6, tgt_end: 7 })
  assert.deepEqual(plain(db.prepare("SELECT name, actor FROM ops ORDER BY id DESC LIMIT 1").get()), { name: "setNote", actor: "agent" })
  undo(db, { actor: "agent" })
  assert.deepEqual([note().translation, note().placedAfter], ["1903년에 샀다.", null])
})

test("set_note places a note on its own, and read says when the words it followed are gone", () => {
  const db = fixture()
  setTranslation(db, { segmentId: 2, text: "제무레이의 배", expectVersion: versionOf(db, 2) })
  setNote(db, { noteId: 1, quote: "배" })
  assert.deepEqual([read(db, { ids: [2] }).segments[0].notes[0].placedAfter, read(db, { ids: [2] }).segments[0].notes[0].translation], ["배", "1903년에 샀다."])
  setTranslation(db, { segmentId: 2, text: "제무레이의 보트", expectVersion: versionOf(db, 2) })
  assert.equal(read(db, { ids: [2] }).segments[0].notes[0].placedAfter, null)
})

test("set_note changes a translator's note and moves it", () => {
  const db = fixture()
  setTranslation(db, { segmentId: 3, text: "바나나와 사과", expectVersion: versionOf(db, 3) })
  setNote(db, { noteId: 2, body: "열대 과일의 하나.", quote: "사과" })
  assert.deepEqual(plain(read(db, { ids: [3] }).segments[0].notes), [{ id: 2, kind: "translator", text: "열대 과일의 하나.", quote: "사과" }])
})

test("set_note is refused, with nothing written, when there is nothing to change or nowhere to put it", () => {
  const db = fixture()
  assert.throws(() => setNote(db, { noteId: 1 }), { status: 400, message: /give the note's body, a quote to place it at, or both/ })
  assert.throws(() => setNote(db, { noteId: 1, body: "  " }), { status: 400, message: /body is empty/ })
  assert.throws(() => setNote(db, { noteId: 1, quote: "boat" }), { status: 400, message: /¶2 has no translation yet to place the note in/ })
  assert.throws(() => setNote(db, { noteId: 2, quote: "사과" }), { status: 400, message: /"사과" is not in the paragraph's translation/ })
  assert.throws(() => setNote(db, { noteId: 99, body: "x" }), { status: 404 })
  assert.equal(db.prepare("SELECT count(*) n FROM ops").get().n, 0)
})

test("each write is described for the translator before it happens", () => {
  const db = fixture()
  assert.deepEqual(describeWrite(db, "set_translation", { segmentId: 1, text: "제1장", expectVersion: versionOf(db, 1) }),
    { summary: "Write the translation of ¶1 (it is reviewed; it becomes draft)", segmentId: 1, before: "하나", after: "제1장" })
  assert.deepEqual(describeWrite(db, "set_glossary_term", { term: "Zemurray", translation: "제머리" }),
    { summary: "Glossary: Zemurray → 제머리", segmentId: null, before: "Zemurray → 제무레이", after: "Zemurray → 제머리" })
  assert.deepEqual(describeWrite(db, "add_comment", { segmentId: 2, body: "b" }), { summary: "Comment by Claude on ¶2", segmentId: 2, before: null, after: "b" })
  assert.match(describeWrite(db, "add_translator_note", { segmentId: 3, body: "b", quote: "바나나" }).summary, /it will be printed/)
  assert.deepEqual(describeWrite(db, "edit_translation", { segmentId: 1, quote: "하나", replacement: "제1장", expectVersion: versionOf(db, 1) }),
    { summary: "Edit the translation of ¶1 (it is reviewed; it becomes draft)", segmentId: 1, before: "하나", after: "제1장" })
  assert.deepEqual(describeWrite(db, "set_note", { noteId: 2, body: "열대 과일의 하나." }),
    { summary: "Change the translator's note 2 on ¶3 — it will be printed", segmentId: 3, before: "열대 과일.", after: "열대 과일의 하나." })
  assert.deepEqual(describeWrite(db, "set_note", { noteId: 2, quote: "바나나" }),
    { summary: "Move the translator's note 2 after \"바나나\" in ¶3", segmentId: 3, before: null, after: null })
  setTranslation(db, { segmentId: 2, text: "제무레이의 배", expectVersion: versionOf(db, 2) })
  assert.deepEqual(describeWrite(db, "set_note", { noteId: 1, body: "1903년 구입.", quote: "배" }),
    { summary: "Translate the author's note 1 on ¶2 and place it after \"배\" — it will be printed", segmentId: 2, before: "1903년에 샀다.", after: "1903년 구입." })
  assert.deepEqual(describeWrite(db, "set_note", { noteId: 1, quote: "배" }),
    { summary: "Place the author's note 1 after \"배\" in ¶2", segmentId: 2, before: null, after: null })
  assert.throws(() => describeWrite(db, "set_translation", { segmentId: 99, text: "x" }), { status: 404 })
})

test("a write that would fail is caught before the translator is asked", () => {
  const db = fixture()
  assert.throws(() => describeWrite(db, "set_translation", { segmentId: 2, text: "x", expectVersion: versionOf(db, 2) - 1 }), { status: 409 })
  assert.throws(() => describeWrite(db, "set_translation", { segmentId: 2, text: " ", expectVersion: versionOf(db, 2) }), { status: 400 })
  assert.throws(() => describeWrite(db, "add_comment", { segmentId: 2, side: "source", body: "b", quote: "ship" }), { status: 400 })
  assert.throws(() => describeWrite(db, "add_translator_note", { segmentId: 2, body: "b", quote: "boat" }), { message: /no translation yet/ })
  assert.throws(() => describeWrite(db, "edit_translation", { segmentId: 3, quote: "바나나", replacement: "x", expectVersion: versionOf(db, 3) - 1 }), { status: 409 })
  assert.throws(() => describeWrite(db, "edit_translation", { segmentId: 3, quote: "사과", replacement: "x", expectVersion: versionOf(db, 3) }), { status: 400 })
  assert.throws(() => describeWrite(db, "set_note", { noteId: 1, quote: "boat" }), { message: /no translation yet/ })
  assert.throws(() => describeWrite(db, "set_note", { noteId: 1 }), { status: 400 })
  assert.throws(() => describeWrite(db, "set_note", { noteId: 99, body: "x" }), { status: 404 })
})

test("MCP: the write tools beside the read tools, none of them marked read-only", () => {
  const db = fixture()
  assert.deepEqual(writeTools(db).map((t) => t.name), ["set_translation", "edit_translation", "set_glossary_term", "add_comment", "add_translator_note", "set_note"])
  for (const t of writeTools(db)) assert.notEqual(t.annotations?.readOnlyHint, true, t.name)
})

test("a write that came through a fitz tool is the agent's, with the id of the tool call the SDK handed it", async () => {
  const db = fixture()
  const tools = Object.fromEntries(writeTools(db).map((t) => [t.name, t]))
  const call = (name, args, id) => tools[name].handler(args, { _meta: { "claudecode/toolUseId": id } })
  await call("set_translation", { segmentId: 2, text: "배", expectVersion: versionOf(db, 2) }, "toolu_A")
  await call("add_comment", { segmentId: 2, side: "source", body: "확인" }, "toolu_B")
  assert.deepEqual(db.prepare("SELECT name, actor, tool_use_id FROM ops ORDER BY id").all().map((r) => [r.name, r.actor, r.tool_use_id]),
    [["updateSegment", "agent", "toolu_A"], ["addComment", "agent", "toolu_B"]])
})

test("the translations Claude writes are heard as they are written, for the turn's checks; other writes are not", async () => {
  const db = fixture()
  const heard = []
  const tools = Object.fromEntries(writeTools(db, { wrote: (id) => heard.push(id) }).map((t) => [t.name, t]))
  await tools.set_translation.handler({ segmentId: 2, text: "배", expectVersion: versionOf(db, 2) }, {})
  await tools.edit_translation.handler({ segmentId: 3, quote: "바나나", replacement: "바나나 한 송이", expectVersion: versionOf(db, 3) }, {})
  await tools.add_comment.handler({ segmentId: 2, side: "source", body: "확인" }, {})
  assert.deepEqual(heard, [2, 3])
})

test("the agent's writes are announced like the translator's, as the agent's", () => {
  const db = fixture()
  const heard = []
  watchChanges(db, (c) => heard.push(c))
  setTranslation(db, { segmentId: 2, text: "배", expectVersion: versionOf(db, 2) })
  assert.deepEqual(heard, [{ opId: 1, name: "updateSegment", segmentIds: [2], kind: "do", actor: "agent" }])
})
