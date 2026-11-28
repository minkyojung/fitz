// Cutting a chapter into paragraphs differently: split and merge, and their way back. Rules from the prototype's
// commands.test.mjs; what is new here is that nothing that belongs to a paragraph is lost or left behind.
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { after, before, describe, test } from "node:test"

import type { Doc, Segment } from "../shared/protocol.ts"
import { RequestError } from "./book.ts"
import { openWriter, type Writer } from "./commands.ts"
import { bookCopy, newBook } from "./testing.ts"

const doc = (...texts: string[]): Doc => ({ type: "doc", content: [{ type: "paragraph", content: texts.map((text) => ({ type: "text" as const, text })) }] })
const refused = (status: number, message?: RegExp) => (e: unknown) => e instanceof RequestError && e.status === status && (!message || message.test(e.message))

/** Every row of the book but the log and the edit time, with each paragraph's version and time left out: what a change and
 *  its undo must leave as it was. Rows are sorted, so a row deleted and put back in its place compares equal. */
function everything(db: DatabaseSync): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const { name } of db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT IN ('ops', 'meta') ORDER BY name").all()) {
    out[String(name)] = db.prepare(`SELECT * FROM "${String(name)}"`).all()
      .map((r) => { const { version: _v, updated_at: _u, ...rest } = r as Record<string, unknown>; return JSON.stringify(rest) })
      .sort()
  }
  return out
}

describe("split and merge", () => {
  let dir: string
  let n = 0
  const opened: { writer: Writer; sql: DatabaseSync }[] = []
  before(() => { dir = mkdtempSync(join(tmpdir(), "fitz-structure-")) })
  after(() => {
    for (const o of opened) { o.writer.close(); o.sql.close() }
    rmSync(dir, { recursive: true, force: true })
  })

  /** A chapter of three paragraphs, and things that belong to them: boxes, notes, comments, a relation, an earlier
   *  translation, a quiz card, a suggestion of Claude's. The first is translated. */
  const fixture = async () => {
    const path = await newBook(join(dir, `book-${n++}.db`), (db) => {
      db.exec(`
        INSERT INTO chapter(id, book_id, idx, title, start_page) VALUES (1, 1, 0, 'One', 1);
        INSERT INTO segment(id, chapter_id, idx, page_start, page_end, source_doc, source_text, ocr_text, target_doc, target_text, status, verified) VALUES
          (1, 1, 0, 1, 1, '${JSON.stringify(doc("alpha beta gamma delta"))}', 'alpha beta gamma delta', 'alpha beta gamma delta', '${JSON.stringify(doc("알파 베타 감마 델타"))}', '알파 베타 감마 델타', 'reviewed', 1),
          (2, 1, 1, 1, 2, '${JSON.stringify(doc("epsilon zeta"))}', 'epsilon zeta', 'epsilon zeta', NULL, NULL, 'untranslated', 1),
          (3, 1, 2, 2, 2, '${JSON.stringify(doc("eta theta"))}', 'eta theta', 'eta theta', '${JSON.stringify(doc("에타 세타"))}', '에타 세타', 'draft', 0);
        INSERT INTO segment_box(segment_id, page_no, x0, y0, x1, y1) VALUES (1, 1, 0.1, 0.1, 0.9, 0.3), (2, 1, 0.1, 0.4, 0.9, 0.9), (2, 2, 0.1, 0.0, 0.9, 0.2), (3, 2, 0.1, 0.3, 0.9, 0.5);
        INSERT INTO note(id, segment_id, kind, src_exact, src_prefix, src_suffix, src_start, src_end, anchored) VALUES
          (1, 1, 'author', 'gamma', 'beta ', ' delta', 11, 16, 1),
          (2, 2, 'author', 'zeta', 'epsilon ', '', 8, 12, 1);
        INSERT INTO comment(id, segment_id, side, src_exact, src_prefix, src_suffix, src_start, src_end, body) VALUES
          (1, 2, 'source', 'zeta', 'epsilon ', '', 8, 12, 'on the source'),
          (2, 2, 'target', NULL, NULL, NULL, NULL, NULL, 'on the translation');
        INSERT INTO relation(id, book_id, from_term, to_term, label, segment_id, quote) VALUES (1, 1, 'Epsilon', 'Zeta', 'met', 2, 'zeta');
        INSERT INTO segment_version(id, segment_id, target_doc) VALUES (1, 2, '${JSON.stringify(doc("이전 번역"))}');
        INSERT INTO drill_run(id, slot, status) VALUES (1, '2026-11-01', 'done');
        INSERT INTO drill_card(id, run_id, segment_id, kind, origin, written_by, quote, question, options, answer, why, base_version, due_on, made_on)
          VALUES (1, 1, 2, 'meaning', 'claude', 'translator', 'zeta', 'what?', '["a","b","c","d"]', 0, 'because', 1, '2026-11-02', '2026-11-01');
        INSERT INTO agent_suggestion(id, conversation_id, task, segment_id, side, quote, replacement, why, base_version) VALUES (1, 'c1', 'typos', 2, 'source', 'zeta', 'Zeta', 'a name', 1);
      `)
    })
    const writer = openWriter(path)
    const sql = new DatabaseSync(path, { readOnly: true })
    opened.push({ writer, sql })
    const row = (id: number) => sql.prepare("SELECT * FROM segment WHERE id = ?").get(id) as Record<string, unknown> | undefined
    const order = () => sql.prepare("SELECT id, idx FROM segment WHERE chapter_id = 1 ORDER BY idx").all().map((r) => [r.id, r.idx])
    const boxes = (id: number) => sql.prepare("SELECT page_no, x0, y0, x1, y1 FROM segment_box WHERE segment_id = ? ORDER BY page_no").all(id).map((r) => ({ ...r }))
    const ownerOf = (table: string, id: number) => sql.prepare(`SELECT segment_id FROM "${table}" WHERE id = ?`).get(id)?.segment_id
    const version = (id: number) => Number(row(id)?.version)
    const fk = () => sql.prepare("PRAGMA foreign_key_check").all()
    return { path, writer, sql, row, order, boxes, ownerOf, version, fk }
  }

  test("split cuts at the caret: the tail is a new paragraph after the head, and what lies in it goes with it", async () => {
    const { writer, row, order, boxes, sql, version, fk } = await fixture()
    const others = { 2: version(2), 3: version(3) }
    const [head, tail] = writer.execute("splitSegment", { id: 1, offset: 11, expectVersion: version(1) }) as [Segment, Segment]
    assert.equal(head.sourceText, "alpha beta", "the space at the cut is dropped")
    assert.equal(tail.sourceText, "gamma delta")
    assert.deepEqual(order(), [[1, 0], [tail.id, 1], [2, 2], [3, 3]])
    assert.deepEqual({ kind: tail.kind, verified: tail.verified, ocrText: tail.ocrText, pageStart: tail.pageStart, pageEnd: tail.pageEnd, status: tail.status, targetDoc: tail.targetDoc },
      { kind: "paragraph", verified: false, ocrText: null, pageStart: 1, pageEnd: 1, status: "untranslated", targetDoc: null })
    assert.deepEqual({ verified: head.verified, ocrText: head.ocrText, targetText: head.targetText, status: head.status }, { verified: true, ocrText: "alpha beta gamma delta", targetText: "알파 베타 감마 델타", status: "reviewed" }, "the head keeps its translation; it is the translator's to divide")
    assert.deepEqual(boxes(tail.id), boxes(1), "the tail is drawn where its paragraph was (an approximation)")
    assert.deepEqual({ ...sql.prepare("SELECT segment_id, src_start, src_end FROM note WHERE id = 1").get() }, { segment_id: tail.id, src_start: 0, src_end: 5 })
    assert.equal(row(tail.id)?.source_text, "gamma delta")
    assert.deepEqual({ 2: version(2), 3: version(3) }, others, "renumbering does not change the other paragraphs' versions")
    assert.deepEqual(fk(), [])
  })

  test("split keeps marks on either side of the cut", async () => {
    const { writer, version } = await fixture()
    writer.execute("updateSegment", { id: 1, doc: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "alpha " }, { type: "text", text: "beta gamma", marks: [{ type: "italic" }] }, { type: "text", text: " delta" }] }] } })
    const [head, tail] = writer.execute("splitSegment", { id: 1, offset: 11, expectVersion: version(1) }) as [Segment, Segment]
    assert.deepEqual(head.sourceDoc.content[0]?.content, [{ type: "text", text: "alpha " }, { type: "text", text: "beta", marks: [{ type: "italic" }] }])
    assert.deepEqual(tail.sourceDoc.content[0]?.content, [{ type: "text", text: "gamma", marks: [{ type: "italic" }] }, { type: "text", text: " delta" }])
  })

  test("split refuses a cut that would leave a paragraph empty, a cut outside the text, and a paragraph that changed", async () => {
    const { writer, version, sql, path } = await fixture()
    const before = everything(sql)
    for (const offset of [0, 22, 99, -1, 1.5]) assert.throws(() => writer.execute("splitSegment", { id: 1, offset, expectVersion: version(1) }), refused(400), `offset ${offset}`)
    assert.throws(() => writer.execute("splitSegment", { id: 1, offset: 5, expectVersion: version(1) - 1 }), refused(409))
    assert.throws(() => writer.execute("splitSegment", { id: 99, offset: 5 }), refused(404))
    assert.deepEqual(everything(sql), before)
    assert.equal(Number(sql.prepare("SELECT count(*) n FROM ops").get()?.n), 0, path)
  })

  test("undo of a split puts everything back; redo cuts again under the same id", async () => {
    const { writer, sql, version } = await fixture()
    const before = everything(sql)
    const [, tail] = writer.execute("splitSegment", { id: 1, offset: 11, expectVersion: version(1) }) as [Segment, Segment]
    const cut = everything(sql)
    assert.equal(writer.undo()?.name, "splitSegment")
    assert.deepEqual(everything(sql), before)
    assert.equal(writer.redo()?.name, "splitSegment")
    assert.deepEqual(everything(sql), cut)
    assert.equal(Number(sql.prepare("SELECT id FROM segment WHERE idx = 1 AND chapter_id = 1").get()?.id), tail.id)
  })

  test("merge joins the next paragraph to this one, and takes along all that belonged to it", async () => {
    const { writer, row, order, boxes, ownerOf, sql, version, fk } = await fixture()
    const merged = writer.execute("mergeWithNext", { id: 1, expectVersion: version(1) }) as Segment
    assert.equal(merged.sourceText, "alpha beta gamma delta epsilon zeta")
    assert.deepEqual(merged.sourceDoc, doc("alpha beta gamma delta", " ", "epsilon zeta"))
    assert.equal(row(2), undefined)
    assert.deepEqual(order(), [[1, 0], [3, 1]])
    assert.deepEqual({ pageStart: merged.pageStart, pageEnd: merged.pageEnd, verified: merged.verified }, { pageStart: 1, pageEnd: 2, verified: false }, "a merged paragraph is to be checked again")
    assert.deepEqual(boxes(1), [{ page_no: 1, x0: 0.1, y0: 0.1, x1: 0.9, y1: 0.9 }, { page_no: 2, x0: 0.1, y0: 0, x1: 0.9, y1: 0.2 }], "boxes are joined page by page")
    // the next paragraph's things are the merged one's now: offsets into the source move by its length and a space
    assert.deepEqual({ ...sql.prepare("SELECT segment_id, src_start, src_end FROM note WHERE id = 2").get() }, { segment_id: 1, src_start: 31, src_end: 35 })
    assert.equal(merged.sourceText.slice(31, 35), "zeta")
    assert.deepEqual({ ...sql.prepare("SELECT segment_id, src_start, src_end FROM comment WHERE id = 1").get() }, { segment_id: 1, src_start: 31, src_end: 35 })
    assert.deepEqual({ ...sql.prepare("SELECT segment_id, src_start FROM comment WHERE id = 2").get() }, { segment_id: 1, src_start: null })
    for (const table of ["relation", "segment_version", "drill_card", "agent_suggestion"]) assert.equal(ownerOf(table, 1), 1, table)
    assert.deepEqual(fk(), [])
  })

  test("merge joins the translations too: the head's paragraphs, then the next's; the status is the lower, or draft if one is missing", async () => {
    const { writer, version } = await fixture()
    // ¶1 (reviewed) + ¶2 (none): the translation is ¶1's, now a draft
    const one = writer.execute("mergeWithNext", { id: 1, expectVersion: version(1) }) as Segment
    assert.deepEqual({ targetDoc: one.targetDoc, status: one.status }, { targetDoc: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "알파 베타 감마 델타" }] }] }, status: "draft" })
    // ¶1 (draft) + ¶3 (draft): both, one paragraph each
    const two = writer.execute("mergeWithNext", { id: 1, expectVersion: one.version }) as Segment
    assert.equal(two.targetText, "알파 베타 감마 델타\n에타 세타")
    assert.equal(two.targetDoc?.content.length, 2)
    assert.equal(two.status, "draft")
  })

  test("merge is refused for a chapter's last paragraph and for a paragraph that changed", async () => {
    const { writer, version, sql } = await fixture()
    const before = everything(sql)
    assert.throws(() => writer.execute("mergeWithNext", { id: 3, expectVersion: version(3) }), refused(400, /no following paragraph/))
    assert.throws(() => writer.execute("mergeWithNext", { id: 1, expectVersion: version(1) - 1 }), refused(409))
    assert.deepEqual(everything(sql), before)
  })

  test("undo of a merge brings the next paragraph back as it was, under its id, with its translation and all it had", async () => {
    const { writer, sql, version } = await fixture()
    const before = everything(sql)
    writer.execute("mergeWithNext", { id: 1, expectVersion: version(1) })
    const merged = everything(sql)
    assert.equal(writer.undo()?.name, "mergeWithNext")
    assert.deepEqual(everything(sql), before)
    assert.equal(writer.redo()?.name, "mergeWithNext")
    assert.deepEqual(everything(sql), merged)
    assert.equal(writer.undo()?.name, "mergeWithNext")
    assert.deepEqual(everything(sql), before)
  })

  test("undo of an edit made before a merge is refused while the merge stands", async () => {
    const { writer, version } = await fixture()
    writer.execute("updateSegment", { id: 2, verified: false, expectVersion: version(2) })
    writer.execute("mergeWithNext", { id: 1, expectVersion: version(1) }, { actor: "agent", toolUseId: "toolu_merge" })
    assert.throws(() => writer.undo(), refused(409, /Claude changed ¶2 after this/))
  })

  test("insert puts a new paragraph after the one given — a caption on a page — and its undo takes it away", async () => {
    const { writer, order, row, boxes, sql, version } = await fixture()
    const before = everything(sql)
    const others = { 1: version(1), 2: version(2), 3: version(3) }
    const caption = writer.execute("insertSegment", { chapterId: 1, afterIdx: 1, kind: "caption", text: "A photograph", pageNo: 2 }) as Segment
    assert.deepEqual(order(), [[1, 0], [2, 1], [caption.id, 2], [3, 3]])
    assert.deepEqual({ kind: caption.kind, sourceText: caption.sourceText, ocrText: caption.ocrText, pageStart: caption.pageStart, pageEnd: caption.pageEnd, verified: caption.verified, status: caption.status, boxes: caption.boxes },
      { kind: "caption", sourceText: "A photograph", ocrText: null, pageStart: 2, pageEnd: 2, verified: false, status: "untranslated", boxes: [] })
    assert.deepEqual({ 1: version(1), 2: version(2), 3: version(3) }, others)
    assert.deepEqual(boxes(caption.id), [])
    const first = writer.execute("insertSegment", { chapterId: 1, afterIdx: -1, kind: "heading", text: "First", pageNo: 1 }) as Segment
    assert.equal(order()[0]![0], first.id)
    assert.equal(writer.undo()?.name, "insertSegment")
    assert.equal(writer.undo()?.name, "insertSegment")
    assert.deepEqual(everything(sql), before)
    assert.equal(writer.redo()?.name, "insertSegment")
    assert.equal(row(caption.id)?.source_text, "A photograph", "redo puts it back under the same id")
  })

  test("insert refuses no text, an unknown kind and a chapter that is not there; delete refuses a paragraph something belongs to", async () => {
    const { writer, sql } = await fixture()
    const before = everything(sql)
    assert.throws(() => writer.execute("insertSegment", { chapterId: 1, afterIdx: 0, kind: "caption", text: "  ", pageNo: 1 }), refused(400))
    assert.throws(() => writer.execute("insertSegment", { chapterId: 1, afterIdx: 0, kind: "poem", text: "x", pageNo: 1 }), refused(400))
    assert.throws(() => writer.execute("insertSegment", { chapterId: 9, afterIdx: 0, kind: "caption", text: "x", pageNo: 1 }), refused(404))
    assert.throws(() => writer.execute("insertSegment", { chapterId: 1, afterIdx: 7, kind: "caption", text: "x", pageNo: 1 }), refused(400))
    assert.throws(() => writer.execute("deleteSegment", { id: 2 }), refused(400, /belongs to it/))
    assert.deepEqual(everything(sql), before)
  })

  test("undo of an insert is refused once the inserted paragraph was changed after it", async () => {
    const { writer } = await fixture()
    const caption = writer.execute("insertSegment", { chapterId: 1, afterIdx: 0, kind: "caption", text: "Caption", pageNo: 1 }) as Segment
    writer.execute("updateSegment", { id: caption.id, text: "A photograph of the docks", expectVersion: caption.version }, { actor: "agent", toolUseId: "toolu_c" })
    assert.throws(() => writer.undo(), refused(409, /Claude changed/))
  })
})

describe("split and merge on the real book: undone, nothing has changed", () => {
  let dir: string
  let writer: Writer
  let sql: DatabaseSync
  before(async () => {
    dir = mkdtempSync(join(tmpdir(), "fitz-structure-real-"))
    const { path } = await bookCopy(dir, "migrated")
    writer = openWriter(path)
    sql = new DatabaseSync(path, { readOnly: true })
  })
  after(() => {
    writer?.close()
    sql?.close()
    rmSync(dir, { recursive: true, force: true })
  })

  test("every paragraph that has notes, comments, relations, earlier translations or quiz cards, merged into the one before it and taken back", () => {
    const before = everything(sql)
    const owners = sql.prepare(
      `SELECT DISTINCT s.id, p.id prev, p.version FROM segment s JOIN segment p ON p.chapter_id = s.chapter_id AND p.idx = s.idx - 1
       WHERE s.id IN (SELECT segment_id FROM note UNION SELECT segment_id FROM comment UNION SELECT segment_id FROM relation
                      UNION SELECT segment_id FROM segment_version UNION SELECT segment_id FROM drill_card)
       ORDER BY s.id LIMIT 40`,
    ).all()
    assert.ok(owners.length >= 10, `the copy has paragraphs with things on them (${owners.length})`)
    for (const o of owners) {
      writer.execute("mergeWithNext", { id: Number(o.prev), expectVersion: Number(sql.prepare("SELECT version FROM segment WHERE id = ?").get(Number(o.prev))?.version) })
      assert.deepEqual(sql.prepare("PRAGMA foreign_key_check").all(), [], `after merging ${o.id}`)
      writer.undo()
    }
    assert.deepEqual(everything(sql), before)
  })

  test("every paragraph split in the middle and taken back", () => {
    const before = everything(sql)
    const rows = sql.prepare("SELECT id, source_text, version FROM segment WHERE length(source_text) > 20 ORDER BY id LIMIT 60").all()
    for (const r of rows) {
      const text = String(r.source_text)
      const offset = text.indexOf(" ", Math.floor(text.length / 2)) + 1
      if (offset <= 0) continue
      writer.execute("splitSegment", { id: Number(r.id), offset, expectVersion: Number(r.version) })
      writer.undo()
    }
    assert.deepEqual(everything(sql), before)
  })
})
