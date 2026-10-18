/** Manuscript model for export: what goes where, decided once here and rendered by docx.mjs.
 *
 *  A chapter is a list of paragraphs; a paragraph (one segment) is a list of blocks (the translation's
 *  paragraphs); a block is a list of runs — text runs with an italic flag, and note runs where a footnote
 *  or endnote reference sits. Nothing is numbered here: Word numbers notes in reading order, so order is
 *  all that matters, and it follows the same rules as app/src/lib/footnotes.ts (an author's note not yet
 *  placed in the translation sits at the end of its paragraph).
 *
 *  Schemes: A = author's notes as endnotes, translator's notes as symbol footnotes (CMOS 14.25);
 *  B = everything as one numbered series of footnotes; C = the same series as endnotes. Under B and C a
 *  translator's note ends with " —옮긴이" so the reader can still tell them apart. */

import { locateAnchor } from "./anchor.mjs"

export const SCHEMES = ["A", "B", "C"]
export const TRANSLATOR_TAG = " —옮긴이"

/** Characters as the manuscript-sheet count sees them: code points, newlines excluded (app/src/lib/manuscript.ts). */
export const charCount = (text) => Array.from(text.replace(/\r?\n/g, "")).length

const anchorOf = (r, p) =>
  r[`${p}_exact`] == null ? null : { exact: r[`${p}_exact`], prefix: r[`${p}_prefix`] ?? "", suffix: r[`${p}_suffix`] ?? "", start: r[`${p}_start`], end: r[`${p}_end`] }

/** A ProseMirror doc as blocks of runs; the plain text of each block is what anchors are located in. */
const docBlocks = (doc) =>
  (doc.content ?? []).map((p) => ({
    runs: (p.content ?? []).filter((n) => n.text).map((n) => ({ text: n.text, italic: (n.marks ?? []).some((m) => m.type === "italic") })),
  }))

/** Map an offset in the joined text (blocks joined by "\n") to a block and an offset inside it. */
function locateInBlocks(blocks, offset) {
  let base = 0
  for (let b = 0; b < blocks.length; b++) {
    const len = blocks[b].runs.reduce((n, r) => n + r.text.length, 0)
    if (offset <= base + len) return { block: b, at: offset - base }
    base += len + 1
  }
  return { block: blocks.length - 1, at: Infinity }
}

/** Insert note runs into a block's runs at character offsets, splitting text runs as needed. */
function insertNotes(runs, notes) {
  const out = []
  let pos = 0
  let pending = [...notes].sort((a, b) => a.at - b.at || a.id - b.id)
  const flush = (upTo) => {
    while (pending.length && pending[0].at <= upTo) { const n = pending.shift(); out.push({ note: n.note }) }
  }
  for (const r of runs) {
    let cut = 0
    for (const n of pending) {
      if (n.at >= pos + r.text.length) break
      if (n.at > pos + cut) { out.push({ text: r.text.slice(cut, n.at - pos), italic: r.italic }); cut = n.at - pos }
      flush(n.at)
    }
    if (cut < r.text.length) out.push({ text: r.text.slice(cut), italic: r.italic })
    pos += r.text.length
  }
  flush(Infinity)
  return out
}

/** Build the manuscript for the given chapters (all when omitted). Read-only. */
export function buildManuscript(db, { chapterIds, scheme = "A" } = {}) {
  if (!SCHEMES.includes(scheme)) throw Object.assign(new Error(`unknown scheme ${scheme}`), { status: 400 })
  const book = db.prepare("SELECT * FROM book ORDER BY id LIMIT 1").get()
  const chapterRows = db.prepare("SELECT * FROM chapter WHERE book_id = ? ORDER BY idx").all(book.id)
    .filter((c) => !chapterIds || chapterIds.includes(c.id))
  const segStmt = db.prepare("SELECT * FROM segment WHERE chapter_id = ? ORDER BY idx")
  const noteStmt = db.prepare("SELECT * FROM note WHERE segment_id = ? ORDER BY id")
  const warnings = []
  const stats = { chapters: chapterRows.length, segments: 0, untranslated: 0, authorNotes: 0, translatorNotes: 0, unplaced: 0, untranslatedNotes: 0, chars: 0 }
  const tag = (kind) => (scheme !== "A" && kind === "translator" ? TRANSLATOR_TAG : "")

  const chapters = chapterRows.map((c) => {
    const segments = segStmt.all(c.id)
    const chapter = { id: c.id, idx: c.idx, title: c.title, paragraphs: [], segments: segments.length, untranslated: 0, unplaced: 0, chars: 0 }
    for (const s of segments) {
      const untranslated = !s.target_doc || !(s.target_text ?? "").trim()
      const doc = JSON.parse(untranslated ? s.source_doc : s.target_doc)
      const blocks = docBlocks(doc)
      const text = untranslated ? s.source_text : s.target_text
      if (untranslated) { warnings.push({ kind: "untranslated", chapterId: c.id, segmentId: s.id, idx: s.idx }); chapter.untranslated++ }
      else chapter.chars += charCount(text)
      const placed = new Map() // block → notes
      for (const n of noteStmt.all(s.id)) {
        if (n.kind === "author") stats.authorNotes++; else stats.translatorNotes++
        if (n.kind === "author" && !(n.body_target ?? "").trim()) { warnings.push({ kind: "untranslatedNote", chapterId: c.id, segmentId: s.id, idx: s.idx, noteId: n.id }); stats.untranslatedNotes++ }
        const body = (n.kind === "author" ? n.body_target || n.body_source : n.body_target) ?? ""
        const note = { id: n.id, kind: n.kind, body: body + tag(n.kind), lang: n.kind === "author" && !n.body_target ? "en" : "ko" }
        // where the reference goes: the translator's placement; in an untranslated paragraph the book's own
        const anchor = untranslated ? anchorOf(n, "src") : anchorOf(n, "tgt")
        const at = anchor ? locateAnchor(text, anchor) : null
        let where
        if (at) where = locateInBlocks(blocks, at.end)
        else {
          where = { block: Math.max(0, blocks.length - 1), at: Infinity }
          if (n.kind === "author" && !untranslated) { warnings.push({ kind: "unplaced", chapterId: c.id, segmentId: s.id, idx: s.idx, noteId: n.id }); chapter.unplaced++ }
          else if (anchor) warnings.push({ kind: "lostAnchor", chapterId: c.id, segmentId: s.id, idx: s.idx, noteId: n.id })
        }
        if (!placed.has(where.block)) placed.set(where.block, [])
        placed.get(where.block).push({ at: where.at, id: n.id, note })
      }
      const outBlocks = blocks.length ? blocks : [{ runs: [] }]
      chapter.paragraphs.push({
        segmentId: s.id, idx: s.idx, kind: s.kind, untranslated,
        blocks: outBlocks.map((b, i) => ({ runs: placed.has(i) ? insertNotes(b.runs, placed.get(i)) : b.runs })),
      })
    }
    // the chapter title: an opening heading segment is the (translated) title; otherwise the TOC title is added
    chapter.titleFromHeading = chapter.paragraphs[0]?.kind === "heading"
    stats.segments += chapter.segments; stats.untranslated += chapter.untranslated; stats.unplaced += chapter.unplaced; stats.chars += chapter.chars
    return chapter
  })
  return { title: book.title, author: book.author ?? null, scheme, chapters, warnings, stats }
}

/** Download name: title, chapter range, date. */
export function exportFilename(m, date = new Date()) {
  const idxs = m.chapters.map((c) => c.idx + 1)
  const range = idxs.length ? (idxs.length === 1 ? `${idxs[0]}` : `${Math.min(...idxs)}-${Math.max(...idxs)}`) : "0"
  const day = date.toISOString().slice(0, 10)
  return `${m.title.replace(/\s+/g, "_")}_${range}_${day}.docx`
}
