// node --test server/
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import { DatabaseSync } from "node:sqlite"

import { COMMANDS, execute, listOps, redo, undo } from "./commands.mjs"

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
      VALUES (1, 1, 0, 'heading',   3, 3, 'One', '{}', 'One', 1),
             (2, 1, 1, 'paragraph', 3, 4, 'alpha beta gamma delta', '{}', 'alpha beta gamma delta', 1),
             (3, 1, 2, 'paragraph', 4, 4, 'epsilon zeta', '{}', 'epsilon zeta', 0),
             (4, 1, 3, 'paragraph', 5, 5, 'last one', '{}', 'last one', 0);
    INSERT INTO note(id, segment_id, kind, src_exact, src_start, src_end, anchored)
      VALUES (1, 2, 'author', 'gamma', 11, 16, 1),
             (2, 3, 'author', 'zeta', 8, 12, 1),
             (3, 4, 'author', NULL, NULL, NULL, 0);
    INSERT INTO comment(id, segment_id, side, body) VALUES (1, 3, 'source', 'hmm');
  `)
  return db
}

/** Everything undo must restore, in a comparable shape. */
const snapshot = (db) => ({
  segments: db.prepare("SELECT id, idx, kind, page_start, page_end, ocr_text, source_text, verified FROM segment ORDER BY id").all(),
  notes: db.prepare("SELECT id, segment_id, src_start, src_end, anchored FROM note ORDER BY id").all(),
  comments: db.prepare("SELECT id, segment_id FROM comment ORDER BY id").all(),
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

test("every command has a registered inverse", () => {
  const db = fixture()
  for (const name of Object.keys(COMMANDS)) assert.ok(COMMANDS[name], name)
  const { inverse } = COMMANDS.updateSegment(db, { id: 2, verified: false })
  assert.ok(COMMANDS[inverse.name])
})
