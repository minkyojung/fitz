// node --test server/
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import { DatabaseSync } from "node:sqlite"

import { COMMANDS, docText, execute, listAnnotations, listGlossary, listOps, listSuggestions, mergeDocs, pmDoc, redo, replaceAll, replaceInDoc, replaceRange, search, splitDoc, touches, undo, undoAgent, agentOps, watchChanges } from "./commands.mjs"

const CLAUDE = { actor: "agent" }
const SCHEMA = readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8")
// node:sqlite returns null-prototype rows; plain objects compare cleanly
const plain = (v) => JSON.parse(JSON.stringify(v))

function fixture() {
  const db = new DatabaseSync(":memory:")
  db.exec(SCHEMA)
  db.exec(`
    INSERT INTO book(id, title, source_pdf) VALUES (1, 'T', 'x.pdf');
    INSERT INTO chapter(id, book_id, idx, title, start_page) VALUES (1, 1, 0, 'One', 3);
    INSERT INTO segment(id, chapter_id, idx, kind, page_start, page_end, ocr_text, source_doc, source_text, verified)
      VALUES (1, 1, 0, 'heading',   3, 3, 'One', '${pmDoc("One")}', 'One', 1),
             (2, 1, 1, 'paragraph', 3, 4, 'alpha beta gamma delta', '${pmDoc("alpha beta gamma delta")}', 'alpha beta gamma delta', 1),
             (3, 1, 2, 'paragraph', 4, 4, 'epsilon zeta', '${pmDoc("epsilon zeta")}', 'epsilon zeta', 0),
             (4, 1, 3, 'paragraph', 5, 5, 'last one', '${pmDoc("last one")}', 'last one', 0);
    INSERT INTO note(id, segment_id, kind, src_exact, src_start, src_end, anchored)
      VALUES (1, 2, 'author', 'gamma', 11, 16, 1),
             (2, 3, 'author', 'zeta', 8, 12, 1),
             (3, 4, 'author', NULL, NULL, NULL, 0);
    INSERT INTO comment(id, segment_id, side, body) VALUES (1, 3, 'source', 'hmm');
    INSERT INTO segment_box(segment_id, page_no, x0, y0, x1, y1)
      VALUES (2, 3, 0.1, 0.5, 0.9, 0.9), (2, 4, 0.1, 0.1, 0.9, 0.2), (3, 4, 0.1, 0.25, 0.8, 0.4), (4, 5, 0.1, 0.1, 0.9, 0.3);
  `)
  return db
}

/** Everything undo must restore, in a comparable shape. */
const snapshot = (db) => ({
  segments: db.prepare("SELECT id, idx, kind, page_start, page_end, ocr_text, source_text, source_doc, target_doc, target_text, status, verified FROM segment ORDER BY id").all(),
  notes: db.prepare("SELECT id, segment_id, kind, src_start, src_end, tgt_exact, tgt_start, body_target, anchored FROM note ORDER BY id").all(),
  comments: db.prepare("SELECT id, segment_id, side, parent_id, src_exact, src_start, body, resolved FROM comment ORDER BY id").all(),
  glossary: db.prepare("SELECT book_id, term, translation, aliases, kind FROM glossary ORDER BY term").all(),
  boxes: db.prepare("SELECT * FROM segment_box ORDER BY segment_id, page_no").all(),
})
const opsCount = (db, undone) => db.prepare("SELECT count(*) n FROM ops WHERE undone = ?").get(undone ? 1 : 0).n

const roundTrip = (name, params) => {
  test(`${name}: execute → undo restores, redo reapplies`, () => {
    const db = fixture()
    const before = snapshot(db)
    execute(db, name, params)
    const after = snapshot(db)
    assert.notDeepEqual(after, before)
    assert.equal(opsCount(db, false), 1)

    assert.ok(undo(db))
    assert.deepEqual(snapshot(db), before)
    assert.equal(opsCount(db, true), 1)

    assert.ok(redo(db))
    assert.deepEqual(snapshot(db), after)
    assert.equal(opsCount(db, false), 1)

    assert.ok(undo(db))
    assert.deepEqual(snapshot(db), before)
    assert.ok(db.prepare("SELECT value FROM meta WHERE key='last_edit_at'").get())
  })
}

roundTrip("updateSegment", { id: 2, text: "alpha BETA", kind: "blockquote", verified: false })
roundTrip("splitSegment", { id: 2, offset: 11 })      // "alpha beta " | "gamma delta" → note 1 moves to tail
roundTrip("mergeWithNext", { id: 2 })                  // pulls segment 3 (note 2, comment 1) into 2
roundTrip("setNoteAnchor", { noteId: 3, segmentId: 2, anchored: true })
roundTrip("insertSegment", { chapterId: 1, afterIdx: 1, kind: "caption", text: "A photo", pageNo: 4 })
roundTrip("addGlossaryWord", { bookId: 1, term: "Zemurray" })
roundTrip("setGlossaryTerm", { bookId: 1, term: "alpha", translation: "알파", aliases: "알파벳", kind: "person" })
const pmDocJ = (t) => JSON.parse(pmDoc(t))
const A = { exact: "beta", prefix: "alpha ", suffix: " gamma", start: 6, end: 10 }
roundTrip("addComment", { segmentId: 2, side: "source", anchor: A, body: "check this" })
roundTrip("setComment", { id: 1, body: "edited", resolved: true })
roundTrip("deleteComment", { id: 1 })
roundTrip("addNote", { segmentId: 2, anchor: { exact: "베타", prefix: "", suffix: "", start: 0, end: 2 }, body: "옮긴이 주" })
roundTrip("setNote", { id: 1, targetAnchor: { exact: "감마", prefix: "", suffix: "", start: 3, end: 5 } })
roundTrip("updateSegment", { id: 2, targetDoc: pmDocJ("알파 베타"), status: "reviewed" })

test("a first translation moves the status to draft, clearing it moves back, and versions are kept", () => {
  const db = fixture()
  const r1 = execute(db, "updateSegment", { id: 2, targetDoc: pmDocJ("알파 베타 감마") })
  assert.equal(r1.status, "draft")
  assert.equal(r1.targetText, "알파 베타 감마")
  assert.equal(db.prepare("SELECT count(*) n FROM segment_version WHERE segment_id = 2").get().n, 0) // nothing to snapshot yet
  execute(db, "updateSegment", { id: 2, targetDoc: pmDocJ("알파 베타 감마 델타") })
  assert.equal(db.prepare("SELECT count(*) n FROM segment_version WHERE segment_id = 2").get().n, 1)
  const r3 = execute(db, "updateSegment", { id: 2, status: "final" })
  assert.equal(r3.status, "final")
  const r4 = execute(db, "updateSegment", { id: 2, targetDoc: null })
  assert.equal(r4.status, "untranslated")
  assert.equal(r4.targetText, "")
  assert.throws(() => execute(db, "updateSegment", { id: 2, status: "done" }), /bad status/)
  undo(db)
  assert.equal(db.prepare("SELECT status FROM segment WHERE id = 2").get().status, "final")
})

test("split moves a note into the tail and unsplit brings it back at the same offset", () => {
  const db = fixture()
  const [, tail] = execute(db, "splitSegment", { id: 2, offset: 11 })
  const moved = plain(db.prepare("SELECT segment_id, src_start FROM note WHERE id = 1").get())
  assert.deepEqual(moved, { segment_id: tail.id, src_start: 0 })
  assert.equal(db.prepare("SELECT source_text FROM segment WHERE id = ?").get(tail.id).source_text, "gamma delta")
  undo(db)
  assert.deepEqual(plain(db.prepare("SELECT segment_id, src_start FROM note WHERE id = 1").get()), { segment_id: 2, src_start: 11 })
})

test("unmerge restores the deleted segment under its original id and idx order stays contiguous", () => {
  const db = fixture()
  execute(db, "mergeWithNext", { id: 2 })
  assert.equal(db.prepare("SELECT count(*) n FROM segment WHERE id = 3").get().n, 0)
  undo(db)
  const rows = plain(db.prepare("SELECT id, idx FROM segment ORDER BY idx").all())
  assert.deepEqual(rows, [{ id: 1, idx: 0 }, { id: 2, idx: 1 }, { id: 3, idx: 2 }, { id: 4, idx: 3 }])
  assert.equal(db.prepare("SELECT ocr_text FROM segment WHERE id = 3").get().ocr_text, "epsilon zeta")
})

test("redo after split keeps the same tail id, so later ops stay valid", () => {
  const db = fixture()
  const [, tail] = execute(db, "splitSegment", { id: 2, offset: 11 })
  execute(db, "updateSegment", { id: tail.id, verified: true })
  undo(db); undo(db)
  redo(db); redo(db)
  assert.equal(db.prepare("SELECT verified FROM segment WHERE id = ?").get(tail.id).verified, 1)
})

test("a new action discards the redo stack", () => {
  const db = fixture()
  execute(db, "updateSegment", { id: 3, verified: true })
  undo(db)
  assert.equal(opsCount(db, true), 1)
  execute(db, "updateSegment", { id: 4, verified: true })
  assert.equal(opsCount(db, true), 0)
  assert.equal(redo(db), null)
})

test("undo and redo return null when there is nothing to do", () => {
  const db = fixture()
  assert.equal(undo(db), null)
  assert.equal(redo(db), null)
})

test("a failing command leaves no log row and no changes", () => {
  const db = fixture()
  const before = snapshot(db)
  assert.throws(() => execute(db, "splitSegment", { id: 2, offset: 0 }), /empty segment/)
  assert.deepEqual(snapshot(db), before)
  assert.equal(opsCount(db, false), 0)
  assert.throws(() => execute(db, "mergeWithNext", { id: 4 }), /no following/)
})

test("listOps filters by affected segment", () => {
  const db = fixture()
  execute(db, "updateSegment", { id: 3, verified: true })
  execute(db, "mergeWithNext", { id: 2 })
  assert.equal(listOps(db).length, 2)
  assert.deepEqual(listOps(db, { segmentId: 4 }), [])
  assert.deepEqual(listOps(db, { segmentId: 3 }).map((o) => o.name), ["mergeWithNext", "updateSegment"])
})

test("listOps exposes before/after text for text edits only", () => {
  const db = fixture()
  execute(db, "updateSegment", { id: 3, text: "epsilon ZETA" })
  execute(db, "updateSegment", { id: 3, verified: true })
  const [verify, edit] = listOps(db, { segmentId: 3 })
  assert.deepEqual([edit.before, edit.after], ["epsilon zeta", "epsilon ZETA"])
  assert.deepEqual([verify.before, verify.after], [null, null])
})

const ITALIC_DOC = { type: "doc", content: [{ type: "paragraph", content: [
  { type: "text", text: "alpha " }, { type: "text", text: "beta", marks: [{ type: "italic" }] }, { type: "text", text: " gamma" } ] }] }

test("updateSegment with a doc keeps marks and derives the text; undo restores the previous doc", () => {
  const db = fixture()
  const before = db.prepare("SELECT source_doc FROM segment WHERE id = 2").get().source_doc
  execute(db, "updateSegment", { id: 2, doc: ITALIC_DOC })
  const row = db.prepare("SELECT source_doc, source_text FROM segment WHERE id = 2").get()
  assert.equal(row.source_text, "alpha beta gamma")
  assert.deepEqual(JSON.parse(row.source_doc), ITALIC_DOC)
  undo(db)
  assert.equal(db.prepare("SELECT source_doc FROM segment WHERE id = 2").get().source_doc, before)
  redo(db)
  assert.deepEqual(JSON.parse(db.prepare("SELECT source_doc FROM segment WHERE id = 2").get().source_doc), ITALIC_DOC)
})

test("updateSegment rejects docs that are not a single paragraph", () => {
  const db = fixture()
  const two = { type: "doc", content: [{ type: "paragraph", content: [] }, { type: "paragraph", content: [] }] }
  assert.throws(() => execute(db, "updateSegment", { id: 2, doc: two }), /single paragraph/)
  assert.equal(docText(ITALIC_DOC), "alpha beta gamma")
})

test("splitDoc and mergeDocs keep marks and trim like the text path", () => {
  const [h, t] = splitDoc(ITALIC_DOC, 8) // "alpha be" | "ta gamma"
  assert.equal(docText(h), "alpha be")
  assert.equal(docText(t), "ta gamma")
  assert.deepEqual(h.content[0].content[1].marks, [{ type: "italic" }])
  assert.deepEqual(t.content[0].content[0].marks, [{ type: "italic" }])
  const [h2, t2] = splitDoc(ITALIC_DOC, 6) // boundary on the space: "alpha" | "beta gamma"
  assert.equal(docText(h2), "alpha")
  assert.equal(docText(t2), "beta gamma")
  assert.equal(docText(mergeDocs(h2, t2)), "alpha beta gamma")
  assert.deepEqual(mergeDocs(h2, t2).content[0].content[2].marks, [{ type: "italic" }])
})

test("split and merge of a marked paragraph round-trip through the db with marks intact", () => {
  const db = fixture()
  execute(db, "updateSegment", { id: 2, doc: ITALIC_DOC })
  execute(db, "splitSegment", { id: 2, offset: 6 })
  const tail = db.prepare("SELECT * FROM segment WHERE chapter_id = 1 AND idx = 2").get()
  assert.deepEqual(JSON.parse(tail.source_doc).content[0].content[0].marks, [{ type: "italic" }])
  execute(db, "mergeWithNext", { id: 2 })
  const merged = JSON.parse(db.prepare("SELECT source_doc FROM segment WHERE id = 2").get().source_doc)
  assert.equal(docText(merged), "alpha beta gamma")
  assert.ok(merged.content[0].content.some((n) => n.marks?.[0]?.type === "italic"))
  undo(db); undo(db)
  assert.deepEqual(JSON.parse(db.prepare("SELECT source_doc FROM segment WHERE id = 2").get().source_doc), ITALIC_DOC)
})

test("split shares the parent's boxes; merge unions boxes per page; undo restores both", () => {
  const db = fixture()
  const [, tail] = execute(db, "splitSegment", { id: 2, offset: 11 })
  assert.deepEqual(plain(tail.boxes), plain(db.prepare("SELECT page_no pageNo, x0, y0, x1, y1 FROM segment_box WHERE segment_id = 2 ORDER BY page_no").all()))
  undo(db)
  assert.equal(db.prepare("SELECT count(*) n FROM segment_box WHERE segment_id = ?").get(tail.id).n, 0)

  const merged = execute(db, "mergeWithNext", { id: 2 })
  // page 4: union of (0.1,0.1,0.9,0.2) and (0.1,0.25,0.8,0.4); page 3 untouched
  assert.deepEqual(plain(merged.boxes), [
    { pageNo: 3, x0: 0.1, y0: 0.5, x1: 0.9, y1: 0.9 },
    { pageNo: 4, x0: 0.1, y0: 0.1, x1: 0.9, y1: 0.4 },
  ])
  undo(db)
  assert.deepEqual(plain(db.prepare("SELECT segment_id, page_no, x0, y0, x1, y1 FROM segment_box WHERE segment_id IN (2,3) ORDER BY segment_id, page_no").all()), [
    { segment_id: 2, page_no: 3, x0: 0.1, y0: 0.5, x1: 0.9, y1: 0.9 },
    { segment_id: 2, page_no: 4, x0: 0.1, y0: 0.1, x1: 0.9, y1: 0.2 },
    { segment_id: 3, page_no: 4, x0: 0.1, y0: 0.25, x1: 0.8, y1: 0.4 },
  ])
})

test("insertSegment places the row after afterIdx with contiguous idx; redo keeps its id; delete refuses rows with notes", () => {
  const db = fixture()
  const row = execute(db, "insertSegment", { chapterId: 1, afterIdx: 1, kind: "caption", text: "A photo", pageNo: 4 })
  assert.deepEqual(plain(db.prepare("SELECT id, idx FROM segment WHERE chapter_id = 1 ORDER BY idx").all()),
    [{ id: 1, idx: 0 }, { id: 2, idx: 1 }, { id: row.id, idx: 2 }, { id: 3, idx: 3 }, { id: 4, idx: 4 }])
  assert.equal(db.prepare("SELECT ocr_text FROM segment WHERE id = ?").get(row.id).ocr_text, null)
  undo(db)
  assert.equal(db.prepare("SELECT count(*) n FROM segment WHERE id = ?").get(row.id).n, 0)
  redo(db)
  assert.equal(db.prepare("SELECT kind FROM segment WHERE id = ?").get(row.id).kind, "caption")
  assert.throws(() => execute(db, "deleteSegment", { id: 2 }), /notes or comments/)
  assert.throws(() => execute(db, "insertSegment", { chapterId: 1, afterIdx: 0, kind: "caption", text: "  ", pageNo: 4 }), /text is required/)
})

test("search lists matching segments with counts and snippets in book order", () => {
  const db = fixture()
  const hits = search(db, { query: "a" })
  assert.deepEqual(hits.map((h) => h.segmentId), [2, 3, 4])
  assert.equal(hits[0].count, 6) // "alpha beta gamma delta"
  assert.ok(hits[0].snippet.includes("alpha"))
  assert.deepEqual(search(db, { query: "" }), [])
})

test("replaceInDoc keeps marks and replaces inside each text node", () => {
  const { doc, count } = replaceInDoc(ITALIC_DOC, "a", "A")
  assert.equal(count, 5)
  assert.equal(docText(doc), "AlphA betA gAmmA")
  assert.deepEqual(doc.content[0].content[1].marks, [{ type: "italic" }])
})

test("replaceAll changes every segment in one logged command; undo restores all; nothing matched logs nothing", () => {
  const db = fixture()
  const before = snapshot(db)
  const r = replaceAll(db, { query: "zeta", replacement: "ZETA" })
  assert.deepEqual(r, { segments: 1, occurrences: 1 })
  assert.equal(db.prepare("SELECT source_text FROM segment WHERE id = 3").get().source_text, "epsilon ZETA")
  assert.equal(opsCount(db, false), 1)
  const wide = replaceAll(db, { query: "a", replacement: "4" })
  assert.equal(wide.segments, 2) // segment 3 now reads "epsilon ZETA"
  assert.equal(opsCount(db, false), 2)
  undo(db); undo(db)
  assert.deepEqual(snapshot(db), before)
  assert.deepEqual(replaceAll(db, { query: "nothing-here", replacement: "x" }), { segments: 0, occurrences: 0 })
  assert.equal(opsCount(db, false), 0)
  assert.throws(() => replaceAll(db, { query: "last one", replacement: "" }), /would empty/)
})

test("dictionary words are unique per book and removable", () => {
  const db = fixture()
  execute(db, "addGlossaryWord", { bookId: 1, term: "Cuyamel" })
  assert.throws(() => execute(db, "addGlossaryWord", { bookId: 1, term: "Cuyamel" }), /already/)
  assert.throws(() => execute(db, "addGlossaryWord", { bookId: 1, term: "  " }), /required/)
  undo(db)
  assert.equal(db.prepare("SELECT count(*) n FROM glossary").get().n, 0)
})

test("a translation may hold several paragraphs; its text joins them with newlines; sources may not", () => {
  const db = fixture()
  const two = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "첫째" }] }, { type: "paragraph", content: [{ type: "text", text: "둘째" }] }] }
  const r = execute(db, "updateSegment", { id: 3, targetDoc: two })
  assert.equal(r.targetText, "첫째\n둘째")
  assert.throws(() => execute(db, "updateSegment", { id: 3, doc: two }), /single paragraph/)
})

test("setGlossaryTerm upgrades a dictionary word, keeps the previous row for undo, and counts occurrences", () => {
  const db = fixture()
  execute(db, "addGlossaryWord", { bookId: 1, term: "alpha" })
  execute(db, "setGlossaryTerm", { bookId: 1, term: "alpha", translation: "알파", aliases: "", kind: "person" })
  execute(db, "setGlossaryTerm", { bookId: 1, term: "alpha", translation: "알파2", aliases: "알파", kind: "person" })
  const g = listGlossary(db, { bookId: 1 })
  assert.deepEqual(g.map((x) => [x.term, x.translation, x.occurrences]), [["alpha", "알파2", 1]])
  undo(db)
  assert.equal(listGlossary(db, { bookId: 1 })[0].translation, "알파")
  undo(db)
  assert.equal(listGlossary(db, { bookId: 1 })[0].translation, "")
  undo(db)
  assert.equal(listGlossary(db, { bookId: 1 }).length, 0)
  assert.throws(() => execute(db, "setGlossaryTerm", { bookId: 1, term: "x", kind: "animal" }), /bad kind/)
})

test("comment threads: replies cascade on delete and come back together on undo; listAnnotations groups by chapter", () => {
  const db = fixture()
  const root = execute(db, "addComment", { segmentId: 2, side: "target", anchor: null, body: "root" })
  execute(db, "addComment", { segmentId: 2, side: "target", anchor: null, body: "reply", parentId: root.id })
  assert.equal(listAnnotations(db, { chapterId: 1 }).comments.length, 3) // fixture has one comment already
  execute(db, "deleteComment", { id: root.id })
  assert.equal(listAnnotations(db, { chapterId: 1 }).comments.length, 1)
  undo(db)
  const after = listAnnotations(db, { chapterId: 1 }).comments
  assert.deepEqual(after.filter((c) => c.id >= root.id).map((c) => [c.id, c.parentId, c.body]), [[root.id, null, "root"], [root.id + 1, root.id, "reply"]])
  assert.throws(() => execute(db, "deleteNote", { id: 1 }), /author notes/)
  assert.throws(() => execute(db, "addComment", { segmentId: 2, side: "middle", anchor: null, body: "x" }), /bad side/)
})

test("every command has a registered inverse", () => {
  const db = fixture()
  for (const name of Object.keys(COMMANDS)) assert.ok(COMMANDS[name], name)
  const { inverse } = COMMANDS.updateSegment(db, { id: 2, verified: false })
  assert.ok(COMMANDS[inverse.name])
})

// --- segment versions: two writers (the translator, the agent) never overwrite each other unseen

const versionOf = (db, id) => db.prepare("SELECT version FROM segment WHERE id = ?").get(id).version

test("every change of a segment's content gives it a new, higher version; renumbering does not", () => {
  const db = fixture()
  const start = versionOf(db, 3)
  execute(db, "updateSegment", { id: 3, targetDoc: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "엡실론" }] }] } })
  const afterEdit = versionOf(db, 3)
  assert.ok(afterEdit > start)
  const v4 = versionOf(db, 4)
  execute(db, "insertSegment", { chapterId: 1, afterIdx: 0, kind: "caption", text: "cap", pageNo: 3 })  // shifts idx of 2, 3, 4
  assert.equal(versionOf(db, 4), v4)
  undo(db)
  undo(db)
  assert.ok(versionOf(db, 3) > afterEdit, "undo is a change too: a new number, not the old one back")
})

test("a write that expects an older version is refused and writes nothing; one that expects the current goes through", () => {
  const db = fixture()
  const seen = versionOf(db, 3)
  execute(db, "updateSegment", { id: 3, status: "draft" })  // someone else, meanwhile
  const before = snapshot(db)
  assert.throws(() => execute(db, "updateSegment", { id: 3, text: "overwritten", expectVersion: seen }), { status: 409, message: "segment 3 changed since it was read" })
  assert.deepEqual(snapshot(db), before)
  assert.equal(listOps(db, {}).length, 1)
  execute(db, "updateSegment", { id: 3, text: "epsilon zeta!", expectVersion: versionOf(db, 3) })
  assert.equal(db.prepare("SELECT source_text FROM segment WHERE id = 3").get().source_text, "epsilon zeta!")
})

test("redo of a write made with expectVersion does not depend on that version", () => {
  const db = fixture()
  execute(db, "updateSegment", { id: 3, text: "first", expectVersion: versionOf(db, 3) })
  undo(db)
  assert.ok(redo(db))
  assert.equal(db.prepare("SELECT source_text FROM segment WHERE id = 3").get().source_text, "first")
})

// --- who made each change: the door it came in through

test("a change is the translator's unless it says otherwise; the agent's carries its tool call", () => {
  const db = fixture()
  execute(db, "updateSegment", { id: 3, status: "draft" })
  execute(db, "updateSegment", { id: 4, status: "draft" }, { actor: "agent", toolUseId: "toolu_X" })
  assert.deepEqual(db.prepare("SELECT actor, tool_use_id FROM ops ORDER BY id").all().map((r) => [r.actor, r.tool_use_id]),
    [["translator", null], ["agent", "toolu_X"]])
  assert.throws(() => execute(db, "updateSegment", { id: 3, status: "reviewed" }, { actor: "someone" }))
})

test("undo and redo keep who made the change, and say so", () => {
  const db = fixture()
  execute(db, "updateSegment", { id: 4, status: "draft" }, { actor: "agent", toolUseId: "toolu_X" })
  assert.equal(undo(db, CLAUDE).actor, "agent")
  assert.equal(redo(db, CLAUDE).actor, "agent")
  assert.deepEqual(db.prepare("SELECT actor, tool_use_id FROM ops").all().map((r) => [r.actor, r.tool_use_id]), [["agent", "toolu_X"]])
})

test("a comment keeps its author when deleted and brought back", () => {
  const db = fixture()
  const c = execute(db, "addComment", { segmentId: 2, side: "source", anchor: null, body: "Claude의 메모", author: "agent" }, { actor: "agent", toolUseId: "toolu_C" })
  assert.equal(c.author, "agent")
  execute(db, "deleteComment", { id: c.id })
  undo(db)
  assert.equal(listAnnotations(db, { chapterId: 1 }).comments.find((x) => x.id === c.id).author, "agent")
  assert.equal(listAnnotations(db, { chapterId: 1 }).comments.find((x) => x.id === 1).author, "translator")
})

// --- the book announces each committed write (the live connection passes it to every page)

const translateOne = (db, text) => execute(db, "updateSegment", { id: 1, targetDoc: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] } })
test("a committed write is announced once, after it is in the database", () => {
  const db = fixture()
  const heard = []
  watchChanges(db, (c) => heard.push({ ...c, seen: db.prepare("SELECT target_text FROM segment WHERE id = 1").get().target_text }))
  translateOne(db, "알파")
  assert.deepEqual(heard, [{ opId: 1, name: "updateSegment", segmentIds: [1], kind: "do", actor: "translator", seen: "알파" }])
})

test("a refused write announces nothing", () => {
  const db = fixture()
  const heard = []
  watchChanges(db, (c) => heard.push(c))
  assert.throws(() => execute(db, "updateSegment", { id: 1, text: "x", expectVersion: -1 }), { status: 409 })
  assert.throws(() => execute(db, "updateSegment", { id: 99, text: "x" }), { status: 404 })
  assert.deepEqual(heard, [])
})

test("undo and redo are announced as what they are", () => {
  const db = fixture()
  const heard = []
  translateOne(db, "알파")
  watchChanges(db, (c) => heard.push(c))
  undo(db)
  redo(db)
  assert.deepEqual(heard.map((c) => [c.kind, c.opId, c.name, c.actor]), [["undo", 1, "updateSegment", "translator"], ["redo", 1, "updateSegment", "translator"]])
})

test("a watcher that fails does not undo or fail the write; one that stops watching hears nothing more", () => {
  const db = fixture()
  const heard = []
  const quiet = console.error
  console.error = () => {}
  try {
    watchChanges(db, () => { throw new Error("broken watcher") })
    const stop = watchChanges(db, (c) => heard.push(c.opId))
    translateOne(db, "하나")
    stop()
    translateOne(db, "둘")
  } finally { console.error = quiet }
  assert.equal(db.prepare("SELECT target_text FROM segment WHERE id = 1").get().target_text, "둘")
  assert.deepEqual(heard, [1])
})

// --- Claude's suggestions, decided by the translator (docs/agent.md §4)

const text = (t, marks) => ({ type: "text", text: t, ...(marks && { marks }) })
const EM = [{ type: "em" }]
const docOf = (...paras) => ({ type: "doc", content: paras.map((nodes) => ({ type: "paragraph", content: nodes })) })

test("replaceRange replaces words of a doc's text within one block; the new words take the marks of the first replaced", () => {
  const d = docOf([text("알파 "), text("베타", EM), text(" 감마")], [text("델타 엡실론")])
  assert.deepEqual(replaceRange(d, 3, 5, "B"), docOf([text("알파 "), text("B", EM), text(" 감마")], [text("델타 엡실론")]))
  assert.deepEqual(replaceRange(d, 1, 6, "X"), docOf([text("알X", undefined), text("감마")], [text("델타 엡실론")]), "across nodes: the first keeps it, the rest lose the range")
  assert.deepEqual(replaceRange(d, 3, 5, ""), docOf([text("알파 "), text(" 감마")], [text("델타 엡실론")]), "a node left empty goes")
  assert.equal(docText(replaceRange(d, 9, 11, "Delta")), "알파 베타 감마\nDelta 엡실론", "in the second block")
  assert.throws(() => replaceRange(d, 7, 12, "x"), { status: 400, message: /across two blocks/ })
})

const translated = (db, id, nodes) => execute(db, "updateSegment", { id, targetDoc: docOf(nodes) })
function suggest(db, { segmentId, side = "target", quote, replacement, why = "이유" }) {
  const v = db.prepare("SELECT version FROM segment WHERE id = ?").get(segmentId).version
  return Number(db.prepare(`INSERT INTO agent_suggestion(conversation_id, task, segment_id, side, quote, replacement, why, level, base_version)
    VALUES ('c', ?, ?, ?, ?, ?, ?, ?, ?)`).run(side === "target" ? "review" : "typos", segmentId, side, quote, replacement, why, side === "target" ? "low" : null, v).lastInsertRowid)
}
const statusOf = (db, id) => db.prepare("SELECT status FROM agent_suggestion WHERE id = ?").get(id).status
const lastOp = (db) => plain(db.prepare("SELECT name, actor, undone FROM ops ORDER BY id DESC LIMIT 1").get())

test("accept replaces the words in the translation, as the translator's write; ⌘Z brings back both the words and the suggestion", () => {
  const db = fixture()
  translated(db, 2, [text("알파 "), text("베타", EM), text(" 감마")])
  const id = suggest(db, { segmentId: 2, quote: "베타 감", replacement: "BETA 감" })
  const before = snapshot(db)
  const r = execute(db, "decideSuggestion", { id, decision: "accept" })
  assert.equal(r.status, "accepted")
  const seg = db.prepare("SELECT target_doc, target_text FROM segment WHERE id = 2").get()
  assert.equal(seg.target_text, "알파 BETA 감마")
  assert.deepEqual(JSON.parse(seg.target_doc), docOf([text("알파 "), text("BETA 감", EM), text("마")]))
  assert.deepEqual(lastOp(db), { name: "decideSuggestion", actor: "translator", undone: 0 })
  undo(db)
  assert.deepEqual(snapshot(db), before)
  assert.equal(statusOf(db, id), "open")
  redo(db)
  assert.equal(db.prepare("SELECT target_text FROM segment WHERE id = 2").get().target_text, "알파 BETA 감마")
  assert.equal(statusOf(db, id), "accepted")
})

test("accept on the source fixes the OCR text", () => {
  const db = fixture()
  const id = suggest(db, { segmentId: 3, side: "source", quote: "zeta", replacement: "theta" })
  execute(db, "decideSuggestion", { id, decision: "accept" })
  assert.equal(db.prepare("SELECT source_text FROM segment WHERE id = 3").get().source_text, "epsilon theta")
})

test("accept is refused when the words are no longer there exactly once, and nothing is written", () => {
  const db = fixture()
  translated(db, 2, [text("알파 베타")])
  const gone = suggest(db, { segmentId: 2, quote: "베타", replacement: "B" })
  const twice = suggest(db, { segmentId: 2, quote: "알파", replacement: "A" })
  translated(db, 2, [text("알파 알파 감마")])
  const before = snapshot(db)
  assert.throws(() => execute(db, "decideSuggestion", { id: gone, decision: "accept" }), { status: 409, message: /¶2 changed: "베타" is no longer in it exactly once/ })
  assert.throws(() => execute(db, "decideSuggestion", { id: twice, decision: "accept" }), { status: 409 })
  assert.deepEqual(snapshot(db), before)
  assert.deepEqual([statusOf(db, gone), statusOf(db, twice)], ["open", "open"])
})

test("keep as comment makes it Claude's comment on the words; ⌘Z takes the comment away, redo brings the same one back", () => {
  const db = fixture()
  translated(db, 2, [text("알파 베타 감마")])
  const id = suggest(db, { segmentId: 2, quote: "베타", replacement: "B", why: "용어집" })
  execute(db, "decideSuggestion", { id, decision: "comment" })
  const c = plain(db.prepare("SELECT id, side, author, body, src_exact, src_start, src_end FROM comment WHERE segment_id = 2").get())
  assert.deepEqual({ ...c, id: undefined }, { id: undefined, side: "target", author: "agent", body: "베타 → B\n용어집", src_exact: "베타", src_start: 3, src_end: 5 })
  assert.equal(statusOf(db, id), "commented")
  undo(db)
  assert.equal(db.prepare("SELECT count(*) n FROM comment WHERE segment_id = 2").get().n, 0)
  assert.equal(statusOf(db, id), "open")
  redo(db)
  assert.equal(db.prepare("SELECT id FROM comment WHERE segment_id = 2").get().id, c.id)
})

test("keep as comment on words that are gone puts the comment on the paragraph", () => {
  const db = fixture()
  translated(db, 2, [text("알파 베타")])
  const id = suggest(db, { segmentId: 2, quote: "베타", replacement: "B" })
  translated(db, 2, [text("알파")])
  execute(db, "decideSuggestion", { id, decision: "comment" })
  assert.deepEqual(plain(db.prepare("SELECT src_exact, body FROM comment WHERE segment_id = 2").get()), { src_exact: null, body: "베타 → B\n이유" })
})

test("dismiss changes nothing in the book; ⌘Z reopens it", () => {
  const db = fixture()
  const id = suggest(db, { segmentId: 3, side: "source", quote: "zeta", replacement: "theta" })
  const before = snapshot(db)
  execute(db, "decideSuggestion", { id, decision: "dismiss" })
  assert.deepEqual(snapshot(db), before)
  assert.equal(statusOf(db, id), "dismissed")
  undo(db)
  assert.equal(statusOf(db, id), "open")
})

test("a suggestion is decided once, with one of the three decisions", () => {
  const db = fixture()
  const id = suggest(db, { segmentId: 3, side: "source", quote: "zeta", replacement: "theta" })
  assert.throws(() => execute(db, "decideSuggestion", { id, decision: "toString" }), { status: 400 })
  assert.throws(() => execute(db, "decideSuggestion", { id: 99, decision: "dismiss" }), { status: 404 })
  execute(db, "decideSuggestion", { id, decision: "dismiss" })
  assert.throws(() => execute(db, "decideSuggestion", { id, decision: "accept" }), { status: 409, message: /already dismissed/ })
})

test("a decision is announced as a change to its paragraph", () => {
  const db = fixture()
  const id = suggest(db, { segmentId: 3, side: "source", quote: "zeta", replacement: "theta" })
  const heard = []
  watchChanges(db, (c) => heard.push(c))
  execute(db, "decideSuggestion", { id, decision: "dismiss" })
  undo(db)
  assert.deepEqual(heard.map(({ name, segmentIds, kind }) => ({ name, segmentIds, kind })),
    [{ name: "decideSuggestion", segmentIds: [3], kind: "do" }, { name: "decideSuggestion", segmentIds: [3], kind: "undo" }])
})

test("listSuggestions: a chapter's open suggestions, in book order", () => {
  const db = fixture()
  const late = suggest(db, { segmentId: 4, side: "source", quote: "last", replacement: "least" })
  const early = suggest(db, { segmentId: 2, side: "source", quote: "beta", replacement: "BETA" })
  const decided = suggest(db, { segmentId: 3, side: "source", quote: "zeta", replacement: "theta" })
  execute(db, "decideSuggestion", { id: decided, decision: "dismiss" })
  assert.deepEqual(listSuggestions(db, { chapterId: 1 }).map((s) => s.id), [early, late])
  assert.deepEqual(listSuggestions(db, { chapterId: 2 }), [])
})

// --- two writers, two ways back: what each change touched (docs/agent.md §18)

test("every command says what it touched, read back from the log, both ways: paragraphs, terms, comments, notes, suggestions", () => {
  const db = fixture()
  const doc = (text) => JSON.parse(pmDoc(text))
  execute(db, "updateSegment", { id: 2, text: "alpha beta gamma" })
  execute(db, "splitSegment", { id: 2, offset: 6 })
  execute(db, "mergeWithNext", { id: 2 })  // the halves back together
  const added = execute(db, "insertSegment", { chapterId: 1, afterIdx: 0, kind: "paragraph", text: "new", pageNo: 3 })
  execute(db, "deleteSegment", { id: added.id })
  execute(db, "setDocs", { items: [{ id: 4, doc: doc("last two") }] })
  execute(db, "addGlossaryWord", { bookId: 1, term: "Zeta" })
  execute(db, "setGlossaryTerm", { bookId: 1, term: "Zeta", translation: "제타" })
  execute(db, "removeGlossaryWord", { bookId: 1, term: "Zeta" })
  const c = execute(db, "addComment", { segmentId: 4, side: "source", anchor: null, body: "c" })
  execute(db, "addComment", { segmentId: 4, side: "source", anchor: null, body: "r", parentId: c.id })
  execute(db, "setComment", { id: c.id, body: "c2" })
  execute(db, "deleteComment", { id: c.id })
  const n = execute(db, "addNote", { segmentId: 4, anchor: null, body: "n" })
  execute(db, "setNote", { id: n.id, body: "n2" })
  execute(db, "deleteNote", { id: n.id })
  execute(db, "setNoteAnchor", { noteId: 3, segmentId: 4, anchored: true })
  const sid = Number(db.prepare(`INSERT INTO agent_suggestion(conversation_id, task, segment_id, side, quote, replacement, why, base_version)
    VALUES ('c', 'typos', 4, 'source', 'last', 'least', '-', 1)`).run().lastInsertRowid)
  execute(db, "decideSuggestion", { id: sid, decision: "accept" })

  const named = new Set()
  for (const row of db.prepare("SELECT * FROM ops ORDER BY id").all()) {
    const segmentIds = JSON.parse(row.segment_ids)
    for (const [name, params] of [[row.name, row.params], [row.inverse_name, row.inverse_params]]) {
      const keys = touches({ name, params: JSON.parse(params), segmentIds })
      assert.ok(keys.length > 0, `${name} touched nothing`)
      named.add(name)
    }
  }
  assert.deepEqual([...named].sort(), Object.keys(COMMANDS).sort(), "every command, forward or inverse, is covered")

  const forward = (name) => { const r = db.prepare("SELECT * FROM ops WHERE name = ? ORDER BY id LIMIT 1").get(name); return touches({ name, params: JSON.parse(r.params), segmentIds: JSON.parse(r.segment_ids) }) }
  assert.deepEqual(forward("updateSegment"), ["seg:2"])
  assert.deepEqual(forward("setGlossaryTerm"), ["term:Zeta"])
  assert.deepEqual(forward("addComment"), [`comment:${c.id}`])
  assert.deepEqual(touches({ name: "addComment", params: { id: 9, parentId: c.id }, segmentIds: [4] }), ["comment:9", `comment:${c.id}`], "a reply touches its thread")
  assert.deepEqual(forward("setNoteAnchor"), ["note:3"], "linking a note does not touch the paragraph's text")
  assert.deepEqual(forward("decideSuggestion"), [`suggestion:${sid}`, "seg:4"])
  assert.throws(() => touches({ name: "somethingNew", params: {}, segmentIds: [] }), /not known/)
})

const sourceOf = (db, id) => db.prepare("SELECT source_text FROM segment WHERE id = ?").get(id).source_text

test("⌘Z takes back only the translator's own changes, passing over Claude's", () => {
  const db = fixture()
  execute(db, "updateSegment", { id: 2, text: "mine" })
  execute(db, "updateSegment", { id: 3, text: "Claude's" }, CLAUDE)
  execute(db, "addComment", { segmentId: 4, side: "source", anchor: null, body: "mine too" })
  assert.equal(undo(db).name, "addComment")
  assert.equal(undo(db).name, "updateSegment")
  assert.equal(undo(db), null, "nothing of the translator's is left")
  assert.deepEqual([sourceOf(db, 2), sourceOf(db, 3)], ["alpha beta gamma delta", "Claude's"])
})

test("undo is refused when a later change, still standing, touched the same thing; nothing is written", () => {
  const db = fixture()
  execute(db, "updateSegment", { id: 2, text: "mine" })
  execute(db, "updateSegment", { id: 2, text: "Claude's over mine" }, CLAUDE)
  const before = snapshot(db)
  assert.throws(() => undo(db), (e) => e.status === 409 && e.message === "Claude changed ¶2 after this" && e.blockedBy.actor === "agent")
  assert.deepEqual(snapshot(db), before)
  assert.equal(db.prepare("SELECT count(*) n FROM ops WHERE undone = 1").get().n, 0)

  // once Claude's change is taken back, the translator's goes too
  assert.equal(undo(db, CLAUDE).actor, "agent")
  assert.equal(undo(db).actor, "translator")
  assert.equal(sourceOf(db, 2), "alpha beta gamma delta")
})

test("the same thing is the same paragraph's text, glossary term, comment thread or note — not anything on the paragraph", () => {
  const db = fixture()
  execute(db, "updateSegment", { id: 3, text: "mine" })
  execute(db, "addComment", { segmentId: 3, side: "source", anchor: null, body: "Claude's remark" }, CLAUDE)
  assert.equal(undo(db).name, "updateSegment", "a comment on ¶3 does not stand in the way of ¶3's text")

  execute(db, "setGlossaryTerm", { bookId: 1, term: "Zeta", translation: "제타" })
  execute(db, "setGlossaryTerm", { bookId: 1, term: "Zeta", translation: "지타" }, CLAUDE)
  assert.throws(() => undo(db), { status: 409, message: "Claude changed the glossary term “Zeta” after this" })

  const c = execute(db, "addComment", { segmentId: 4, side: "source", anchor: null, body: "Claude's" }, CLAUDE)
  execute(db, "addComment", { segmentId: 4, side: "source", anchor: null, body: "my reply", parentId: c.id })
  assert.throws(() => undo(db, CLAUDE), { status: 409, message: "You changed the comment after this" }, "a reply is in the thread")
})

test("redo: each writer's own, not over a later change to the same thing; a new change ends only its writer's redo", () => {
  const db = fixture()
  execute(db, "updateSegment", { id: 2, text: "mine" })
  undo(db)
  execute(db, "updateSegment", { id: 2, text: "Claude's" }, CLAUDE)
  assert.throws(() => redo(db), { status: 409, message: "Claude changed ¶2 after this" })

  execute(db, "updateSegment", { id: 3, text: "Claude's ¶3" }, CLAUDE)
  undo(db, CLAUDE)
  execute(db, "updateSegment", { id: 4, text: "mine, new" })
  assert.equal(redo(db), null, "the translator's new change ended the translator's redo")
  assert.equal(redo(db, CLAUDE).segmentIds[0], 3, "but not Claude's")
  assert.equal(sourceOf(db, 3), "Claude's ¶3")
})

// --- Claude's changes, taken back from the conversation (its rewind)

const claude = (toolUseId) => ({ actor: "agent", toolUseId })

test("Claude's changes from a chosen turn on are taken back together, newest first; the translator's stay", () => {
  const db = fixture()
  execute(db, "updateSegment", { id: 2, text: "Claude first" }, claude("toolu_1"))
  execute(db, "updateSegment", { id: 3, text: "mine" })
  execute(db, "updateSegment", { id: 2, text: "Claude again" }, claude("toolu_2"))
  execute(db, "addComment", { segmentId: 4, side: "source", anchor: null, body: "Claude's note" }, claude("toolu_3"))
  const heard = []
  watchChanges(db, (c) => heard.push([c.kind, c.actor]))
  const taken = undoAgent(db, ["toolu_1", "toolu_2", "toolu_3"])
  assert.deepEqual(taken.map((o) => o.name), ["addComment", "updateSegment", "updateSegment"], "newest first")
  assert.deepEqual([sourceOf(db, 2), sourceOf(db, 3)], ["alpha beta gamma delta", "mine"])
  assert.equal(db.prepare("SELECT count(*) n FROM comment WHERE body = ?").get("Claude's note").n, 0)
  assert.deepEqual(heard, [["undo", "agent"], ["undo", "agent"], ["undo", "agent"]])
  assert.deepEqual(agentOps(db, ["toolu_1", "toolu_3", "toolu_none"]).map((o) => [o.toolUseId, o.undone]), [["toolu_1", true], ["toolu_3", true]])
  assert.deepEqual(undoAgent(db, ["toolu_1"]), [], "taken back already")
  assert.deepEqual(undoAgent(db, []), [])
})

test("all or nothing: if anything after one of them, not among them, touched the same thing, none is taken back", () => {
  const db = fixture()
  execute(db, "updateSegment", { id: 2, text: "Claude ¶2" }, claude("toolu_1"))
  execute(db, "updateSegment", { id: 3, text: "Claude ¶3" }, claude("toolu_2"))
  execute(db, "updateSegment", { id: 3, text: "mine over Claude's" })
  const before = snapshot(db)
  assert.throws(() => undoAgent(db, ["toolu_1", "toolu_2"]), { status: 409, message: "You changed ¶3 after this" })
  assert.deepEqual(snapshot(db), before)
  assert.deepEqual(agentOps(db, ["toolu_1", "toolu_2"]).map((o) => o.undone), [false, false])
  assert.equal(undoAgent(db, ["toolu_1"]).length, 1, "from a later point, without the overwritten one, it goes")
})

test("a change of Claude's in another conversation, after these and on the same thing, also stands in the way", () => {
  const db = fixture()
  execute(db, "updateSegment", { id: 2, text: "this conversation" }, claude("toolu_1"))
  execute(db, "updateSegment", { id: 2, text: "another conversation" }, claude("toolu_9"))
  assert.throws(() => undoAgent(db, ["toolu_1"]), { status: 409, message: "Claude changed ¶2 after this" })
})
