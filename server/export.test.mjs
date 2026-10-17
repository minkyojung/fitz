import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import { DatabaseSync } from "node:sqlite"

import { pmDoc } from "./commands.mjs"
import { buildManuscript, exportFilename, TRANSLATOR_TAG } from "./export.mjs"

const SCHEMA = readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8")
const doc = (paras) => JSON.stringify({ type: "doc", content: paras.map((runs) => ({ type: "paragraph", content: runs.map(([text, italic]) => ({ type: "text", text, ...(italic ? { marks: [{ type: "italic" }] } : {}) })) })) })

/** Two chapters. Chapter 1: a heading equal to the title, a two-block italic translation carrying a placed
 *  author's note, an unplaced author's note and a translator's note, then an untranslated paragraph with an
 *  author's note anchored in the source. Chapter 2: one translated paragraph. */
function fixture() {
  const db = new DatabaseSync(":memory:")
  db.exec(SCHEMA)
  const tgt = doc([[["제무레이는 ", false], ["부와 좋은 일자리", true], ["를 약속했다.", false]], [["통상 임금의 열 배였다.", false]]])
  db.exec(`
    INSERT INTO book(id, title, author, source_pdf) VALUES (1, 'The Fish', 'Rich Cohen', 'x.pdf');
    INSERT INTO chapter(id, book_id, idx, title, start_page) VALUES (1, 1, 0, 'Selma', 3), (2, 1, 1, 'Ripes', 9);
    INSERT INTO segment(id, chapter_id, idx, kind, page_start, page_end, source_doc, source_text, target_doc, target_text, status)
      VALUES (1, 1, 0, 'heading',   3, 3, '${pmDoc("Selma")}', 'Selma', '${pmDoc("셀마")}', '셀마', 'final'),
             (2, 1, 1, 'paragraph', 3, 3, '${pmDoc("Zemurray promised wealth and good jobs. Ten times the going rate.")}', 'Zemurray promised wealth and good jobs. Ten times the going rate.',
                                          '${tgt}', '제무레이는 부와 좋은 일자리를 약속했다.\n통상 임금의 열 배였다.', 'draft'),
             (3, 1, 2, 'paragraph', 4, 4, '${pmDoc("Within months he had his first plantation.")}', 'Within months he had his first plantation.', NULL, NULL, 'untranslated'),
             (4, 2, 0, 'paragraph', 9, 9, '${pmDoc("Ripe bananas.")}', 'Ripe bananas.', '${pmDoc("익은 바나나.")}', '익은 바나나.', 'final');
    INSERT INTO note(id, segment_id, kind, src_exact, src_start, src_end, tgt_exact, tgt_prefix, tgt_suffix, tgt_start, tgt_end, body_source, body_target, anchored)
      VALUES (1, 2, 'author', 'good jobs', 29, 38, '좋은 일자리', '제무레이는 부와 ', '를 약속했다.', 9, 15, 'Family interview, 2010.', NULL, 1),
             (2, 2, 'author', 'going rate', 54, 64, NULL, NULL, NULL, NULL, NULL, 'Fortune, 1933.', '포춘, 1933년 3월호.', 1),
             (3, 2, 'translator', NULL, NULL, NULL, '통상 임금', '', '의 열 배였다.', 24, 29, NULL, '1910년대 일당은 약 25센트였다.', 1),
             (4, 3, 'author', 'first plantation', 25, 41, NULL, NULL, NULL, NULL, NULL, 'See Cuyamel records.', NULL, 1);
  `)
  return db
}
const text = (block) => block.runs.map((r) => r.text ?? `[${r.note.id}]`).join("")

test("runs split around note references; an unplaced author's note sits at the end of the last block", () => {
  const m = buildManuscript(fixture(), { chapterIds: [1] })
  const p = m.chapters[0].paragraphs[1]
  assert.equal(p.untranslated, false)
  assert.equal(text(p.blocks[0]), "제무레이는 부와 좋은 일자리[1]를 약속했다.")
  assert.deepEqual(p.blocks[0].runs.map((r) => r.italic ?? "note"), [false, true, "note", false])
  assert.equal(text(p.blocks[1]), "통상 임금[3]의 열 배였다.[2]")
  assert.deepEqual(m.warnings.filter((w) => w.kind === "unplaced").map((w) => w.noteId), [2])
})

test("note bodies: the translation when there is one, else the author's original; translator's notes untagged under scheme A", () => {
  const m = buildManuscript(fixture(), { chapterIds: [1] })
  const notes = Object.fromEntries(m.chapters[0].paragraphs.flatMap((p) => p.blocks.flatMap((b) => b.runs.filter((r) => r.note).map((r) => [r.note.id, r.note]))))
  assert.equal(notes[1].body, "Family interview, 2010."); assert.equal(notes[1].lang, "en")
  assert.equal(notes[2].body, "포춘, 1933년 3월호."); assert.equal(notes[2].lang, "ko")
  assert.equal(notes[3].body, "1910년대 일당은 약 25센트였다.")
})

test("schemes B and C tag translator's notes with —옮긴이", () => {
  for (const scheme of ["B", "C"]) {
    const m = buildManuscript(fixture(), { chapterIds: [1], scheme })
    const runs = m.chapters[0].paragraphs[1].blocks[1].runs.filter((r) => r.note)
    assert.equal(runs.find((r) => r.note.id === 3).note.body, "1910년대 일당은 약 25센트였다." + TRANSLATOR_TAG)
    assert.equal(runs.find((r) => r.note.id === 2).note.body, "포춘, 1933년 3월호.")
  }
})

test("an untranslated paragraph carries the source text with its author's note where the book put it, and a warning", () => {
  const m = buildManuscript(fixture(), { chapterIds: [1] })
  const p = m.chapters[0].paragraphs[2]
  assert.equal(p.untranslated, true)
  assert.equal(text(p.blocks[0]), "Within months he had his first plantation[4].")
  assert.deepEqual(m.warnings.filter((w) => w.kind === "untranslated").map((w) => w.segmentId), [3])
  assert.equal(m.stats.untranslated, 1)
})

test("an opening heading is the chapter title (it is the translated one); stats and chapter selection", () => {
  const all = buildManuscript(fixture())
  assert.deepEqual(all.chapters.map((c) => [c.title, c.titleFromHeading]), [["Selma", true], ["Ripes", false]])
  assert.deepEqual(all.stats, { chapters: 2, segments: 4, untranslated: 1, authorNotes: 3, translatorNotes: 1, unplaced: 1, chars: 2 + 35 + 7 })
  const one = buildManuscript(fixture(), { chapterIds: [2] })
  assert.equal(one.chapters.length, 1); assert.equal(one.chapters[0].id, 2); assert.equal(one.warnings.length, 0)
  assert.equal(exportFilename(all, new Date("2026-10-17T03:00:00Z")), "The_Fish_1-2_2026-10-17.docx")
  assert.equal(exportFilename(one, new Date("2026-10-17T03:00:00Z")), "The_Fish_2_2026-10-17.docx")
})

test("an unknown scheme is a 400", () => {
  assert.throws(() => buildManuscript(fixture(), { scheme: "Z" }), (e) => e.status === 400)
})
