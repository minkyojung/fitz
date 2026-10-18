// Command layer over book.db. Every write goes through execute(), which runs one command in a
// transaction, logs it (with its inverse) to `ops`, and marks the database edited.
// undo() applies the inverse of the last logged command; redo() re-applies a stored forward command.
import { DatabaseSync } from "node:sqlite"

import { makeAnchor } from "./anchor.mjs"

export const KINDS = ["paragraph", "heading", "blockquote", "caption", "verse"]
export const STATUSES = ["untranslated", "draft", "reviewed", "final"]

export const httpError = (status, message) => Object.assign(new Error(message), { status })

export const openDb = (path) => {
  const db = new DatabaseSync(path)
  db.exec("PRAGMA foreign_keys = ON")
  // a database built before segment versions would let one writer silently overwrite another: refuse it
  if (!db.prepare("PRAGMA table_info(segment)").all().some((c) => c.name === "version"))
    throw new Error(`${path} has no segment versions yet; run: uv run python -m pipeline.migrate ${path}`)
  return db
}

export const pmDoc = (text) =>
  JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: text ? [{ type: "text", text }] : [] }] })

/** Plain text of a ProseMirror doc: paragraphs joined by newlines, text nodes only. */
export const docText = (doc) => {
  const para = (n) => (n.content ?? []).map((c) => c.text ?? "").join("")
  return (doc.content ?? []).map(para).join("\n")
}
const paraNodes = (doc) => doc.content[0].content ?? []
const mkDoc = (nodes) => ({ type: "doc", content: [{ type: "paragraph", content: nodes }] })
const trimNodes = (nodes, side) => {
  // drop whitespace at one edge of a paragraph, removing text nodes that become empty
  const out = nodes.map((n) => ({ ...n }))
  while (out.length) {
    const i = side === "start" ? 0 : out.length - 1
    out[i].text = side === "start" ? out[i].text.replace(/^\s+/, "") : out[i].text.replace(/\s+$/, "")
    if (out[i].text) break
    out.splice(i, 1)
  }
  return out
}
/** Split a single-paragraph doc at a text offset, keeping marks. Both halves are trimmed like the text. */
export const splitDoc = (doc, offset) => {
  const head = [], tail = []
  let pos = 0
  for (const n of paraNodes(doc)) {
    const end = pos + n.text.length
    if (end <= offset) head.push(n)
    else if (pos >= offset) tail.push(n)
    else {
      head.push({ ...n, text: n.text.slice(0, offset - pos) })
      tail.push({ ...n, text: n.text.slice(offset - pos) })
    }
    pos = end
  }
  return [mkDoc(trimNodes(head, "end")), mkDoc(trimNodes(tail, "start"))]
}
/** Join two single-paragraph docs with one space, keeping marks. */
export const mergeDocs = (a, b) => mkDoc([...paraNodes(a), { type: "text", text: " " }, ...paraNodes(b)])

/** Replace every occurrence of `query` inside each text node (marks survive; matches never span nodes). */
export const replaceInDoc = (doc, query, replacement) => {
  let count = 0
  const nodes = paraNodes(doc).map((n) => {
    const parts = n.text.split(query)
    count += parts.length - 1
    return { ...n, text: parts.join(replacement) }
  }).filter((n) => n.text !== "")
  return { doc: mkDoc(nodes), count }
}

/** Replace the characters [from, to) of a doc's text — docText's, blocks joined by "\n" — within one block. The new
 *  words take the marks of the first character they replace. */
export const replaceRange = (doc, from, to, text) => {
  let start = 0
  let replaced = false
  const content = doc.content.map((p) => {
    const nodes = p.content ?? []
    let at = start
    const end = start + nodes.reduce((n, c) => n + c.text.length, 0)
    start = end + 1
    if (from < at || to > end) return p
    replaced = true
    const out = []
    let placed = false
    for (const n of nodes) {
      const a = at
      at += n.text.length
      if (at <= from || a >= to) { out.push(n); continue }
      const t = n.text.slice(0, Math.max(0, from - a)) + (placed ? "" : text) + n.text.slice(to - a)
      placed = true
      if (t) out.push({ ...n, text: t })
    }
    return { ...p, content: out }
  })
  if (!replaced) throw httpError(400, "the words to replace run across two blocks")
  return { ...doc, content }
}

/** Where the quote is in the text, if it is there exactly once; -1 otherwise. */
export function findOnce(text, quote) {
  const at = quote ? text.indexOf(quote) : -1
  return at !== -1 && text.indexOf(quote, at + 1) === -1 ? at : -1
}

/** Validate a doc: paragraphs of text nodes (optional marks). Source docs must be exactly one paragraph;
 *  a translation may be written as several blocks inside the same pair. */
const checkDoc = (doc, { multi = false } = {}) => {
  const paras = doc && doc.type === "doc" && Array.isArray(doc.content) ? doc.content : null
  const ok = paras && paras.length >= 1 && (multi || paras.length === 1)
    && paras.every((p) => p.type === "paragraph" && (p.content ?? []).every((n) => n.type === "text" && typeof n.text === "string"))
  if (!ok) throw httpError(400, multi ? "doc must be one or more paragraphs of text" : "doc must be a single paragraph of text")
}

export const segRow = (r) => ({
  id: r.id, chapterId: r.chapter_id, idx: r.idx, kind: r.kind, pageStart: r.page_start, pageEnd: r.page_end,
  sourceText: r.source_text, sourceDoc: JSON.parse(r.source_doc), ocrText: r.ocr_text ?? null,
  targetDoc: r.target_doc ? JSON.parse(r.target_doc) : null, targetText: r.target_text ?? "",
  verified: r.verified === 1, status: r.status, version: r.version,
})
export const anchorOf = (r, p) =>
  r[`${p}_exact`] == null ? null : { exact: r[`${p}_exact`], prefix: r[`${p}_prefix`] ?? "", suffix: r[`${p}_suffix`] ?? "", start: r[`${p}_start`], end: r[`${p}_end`] }

export const noteRow = (r) => ({
  id: r.id, segmentId: r.segment_id, kind: r.kind, origPage: r.orig_page, origQuote: r.orig_quote,
  bodySource: r.body_source, bodyTarget: r.body_target ?? "", anchored: r.anchored === 1,
  sourceAnchor: anchorOf(r, "src"), targetAnchor: anchorOf(r, "tgt"), createdAt: r.created_at,
})
export const commentRow = (r) => ({
  id: r.id, segmentId: r.segment_id, side: r.side, parentId: r.parent_id ?? null, body: r.body,
  resolved: r.resolved === 1, anchor: anchorOf(r, "src"), author: r.author, createdAt: r.created_at,
})
const getComment = (db, id) => {
  const r = db.prepare("SELECT * FROM comment WHERE id = ?").get(id)
  if (!r) throw httpError(404, `comment ${id} not found`)
  return r
}
/** Claude's suggestions (docs/agent.md §4): agent/suggestions.mjs keeps them; deciding each is the translator's. */
export const suggestionRow = (r) => ({
  id: r.id, conversationId: r.conversation_id, task: r.task, segmentId: r.segment_id, side: r.side, quote: r.quote,
  replacement: r.replacement, why: r.why, level: r.level ?? null, baseVersion: r.base_version, status: r.status, createdAt: r.created_at,
})
const getSuggestion = (db, id) => {
  const r = db.prepare("SELECT * FROM agent_suggestion WHERE id = ?").get(id)
  if (!r) throw httpError(404, `suggestion ${id} not found`)
  return r
}
const DECIDED = { accept: "accepted", dismiss: "dismissed", comment: "commented" }
const anchorCols = (p, a) => a ? [a.exact, a.prefix ?? "", a.suffix ?? "", a.start ?? null, a.end ?? null] : [null, null, null, null, null]

/** Boxes of one segment: { pageNo, x0, y0, x1, y1 }[] */
const boxesOf = (db, id) =>
  db.prepare("SELECT page_no, x0, y0, x1, y1 FROM segment_box WHERE segment_id = ? ORDER BY page_no").all(id)
    .map((b) => ({ pageNo: b.page_no, x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1 }))
const setBoxes = (db, id, boxes) => {
  db.prepare("DELETE FROM segment_box WHERE segment_id = ?").run(id)
  const ins = db.prepare("INSERT INTO segment_box(segment_id, page_no, x0, y0, x1, y1) VALUES (?,?,?,?,?,?)")
  for (const b of boxes) ins.run(id, b.pageNo, b.x0, b.y0, b.x1, b.y1)
}
/** Per-page union of two box lists. */
const unionBoxes = (a, b) => {
  const byPage = new Map()
  for (const x of [...a, ...b]) {
    const cur = byPage.get(x.pageNo)
    byPage.set(x.pageNo, cur
      ? { pageNo: x.pageNo, x0: Math.min(cur.x0, x.x0), y0: Math.min(cur.y0, x.y0), x1: Math.max(cur.x1, x.x1), y1: Math.max(cur.y1, x.y1) }
      : { ...x })
  }
  return [...byPage.values()].sort((p, q) => p.pageNo - q.pageNo)
}
/** Segment row for the API, boxes included. */
export const segOut = (db, id) => ({ ...segRow(getSegment(db, id)), boxes: boxesOf(db, id) })

const getSegment = (db, id) => {
  const r = db.prepare("SELECT * FROM segment WHERE id = ?").get(id)
  if (!r) throw httpError(404, `segment ${id} not found`)
  return r
}
const getNote = (db, id) => {
  const r = db.prepare("SELECT * FROM note WHERE id = ?").get(id)
  if (!r) throw httpError(404, `note ${id} not found`)
  return r
}
const touch = (db) =>
  db.prepare("INSERT OR REPLACE INTO meta(key, value) VALUES ('last_edit_at', datetime('now'))").run()

// Shift idx of segments after `afterIdx` by `delta`. Goes through negative values so UNIQUE(chapter_id, idx)
// never collides mid-update (SQLite has no ORDER BY on UPDATE).
const shiftIdx = (db, chapterId, afterIdx, delta) => {
  db.prepare("UPDATE segment SET idx = -(idx + ?) WHERE chapter_id = ? AND idx > ?").run(delta, chapterId, afterIdx)
  db.prepare("UPDATE segment SET idx = -idx WHERE chapter_id = ? AND idx < 0").run(chapterId)
}
const setText = (db, id, text, extra = "") =>
  db.prepare(`UPDATE segment SET source_text = ?, source_doc = ?, updated_at = datetime('now')${extra} WHERE id = ?`)

/** Each command: (db, params) → { result, forward, inverse: {name, params}, segmentIds }. No transactions here. */
export const COMMANDS = {
  // Source: `doc` (ProseMirror JSON) wins over `text`; text is derived from it so marks survive.
  // Target: `targetDoc` (null clears the translation); `status` moves the workflow state.
  // A target change also snapshots the previous translation into segment_version.
  // expectVersion: the version the writer last saw. If the segment changed since, nothing is written (409), so one
  // writer never overwrites what another wrote unseen. Not part of the logged command: redo must not depend on it.
  updateSegment(db, { id, text, doc, kind, verified, targetDoc, status, expectVersion }) {
    const cur = getSegment(db, id)
    if (expectVersion !== undefined && expectVersion !== cur.version) throw httpError(409, `segment ${id} changed since it was read`)
    if (doc !== undefined) checkDoc(doc)
    if (targetDoc != null) checkDoc(targetDoc, { multi: true })
    const nextDoc = doc !== undefined ? JSON.stringify(doc) : text !== undefined ? pmDoc(text) : cur.source_doc
    const nextText = doc !== undefined ? docText(doc) : text !== undefined ? text : cur.source_text
    const nextTarget = targetDoc === undefined ? cur.target_doc : targetDoc === null ? null : JSON.stringify(targetDoc)
    const nextTargetText = nextTarget ? docText(JSON.parse(nextTarget)) : null
    let nextStatus = status ?? cur.status
    if (targetDoc !== undefined && status === undefined) {
      // first translation moves untranslated → draft; clearing it moves back
      if (nextTargetText?.trim() && cur.status === "untranslated") nextStatus = "draft"
      if (!nextTargetText?.trim()) nextStatus = "untranslated"
    }
    const next = { kind: kind ?? cur.kind, verified: verified ?? cur.verified === 1 }
    if (!KINDS.includes(next.kind)) throw httpError(400, "bad kind")
    if (!STATUSES.includes(nextStatus)) throw httpError(400, "bad status")
    if (targetDoc !== undefined && cur.target_doc && nextTarget !== cur.target_doc) {
      db.prepare("INSERT INTO segment_version(segment_id, target_doc) VALUES (?, ?)").run(id, cur.target_doc)
    }
    db.prepare(`UPDATE segment SET source_text = ?, source_doc = ?, kind = ?, verified = ?, target_doc = ?, target_text = ?,
                status = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(nextText, nextDoc, next.kind, next.verified ? 1 : 0, nextTarget, nextTargetText, nextStatus, id)
    return {
      result: segOut(db, id),
      forward: { id, doc: JSON.parse(nextDoc), text: nextText, ...next, targetDoc: nextTarget ? JSON.parse(nextTarget) : null, status: nextStatus },
      inverse: {
        name: "updateSegment",
        params: {
          id, doc: JSON.parse(cur.source_doc), text: cur.source_text, kind: cur.kind, verified: cur.verified === 1,
          targetDoc: cur.target_doc ? JSON.parse(cur.target_doc) : null, status: cur.status,
        },
      },
      segmentIds: [id],
    }
  },

  splitSegment(db, { id, offset, tailId }) {
    const cur = getSegment(db, id)
    const [headDoc, tailDoc] = splitDoc(JSON.parse(cur.source_doc), offset)
    const head = docText(headDoc)
    const tail = docText(tailDoc)
    if (!head || !tail) throw httpError(400, "split would create an empty segment")
    shiftIdx(db, cur.chapter_id, cur.idx, 1) // open a slot for the tail
    setText(db, id, head).run(head, JSON.stringify(headDoc), id)
    const newTailId = db.prepare(
      `INSERT INTO segment(id, chapter_id, idx, kind, page_start, page_end, source_doc, source_text, verified)
       VALUES (?,?,?,?,?,?,?,?,0)`,
    ).run(tailId ?? null, cur.chapter_id, cur.idx + 1, cur.kind, cur.page_end, cur.page_end, JSON.stringify(tailDoc), tail).lastInsertRowid
    // notes whose anchor lies in the tail move with it
    db.prepare("UPDATE note SET segment_id = ?, src_start = src_start - ?, src_end = src_end - ? WHERE segment_id = ? AND src_start >= ?")
      .run(newTailId, offset, offset, id, offset)
    setBoxes(db, newTailId, boxesOf(db, id)) // both halves point at the parent's area (an intended approximation)
    return {
      result: [segOut(db, id), segOut(db, newTailId)],
      forward: { id, offset, tailId: Number(newTailId) },
      inverse: {
        name: "unsplit",
        params: { headId: id, tailId: Number(newTailId), doc: JSON.parse(cur.source_doc), text: cur.source_text, verified: cur.verified === 1, pageEnd: cur.page_end, offset },
      },
      segmentIds: [id, Number(newTailId)],
    }
  },

  unsplit(db, { headId, tailId, doc, text, verified, pageEnd, offset }) {
    const head = getSegment(db, headId)
    const tail = getSegment(db, tailId)
    db.prepare("UPDATE note SET segment_id = ?, src_start = src_start + ?, src_end = src_end + ? WHERE segment_id = ?")
      .run(headId, offset, offset, tailId)
    db.prepare("UPDATE comment SET segment_id = ? WHERE segment_id = ?").run(headId, tailId)
    db.prepare("DELETE FROM segment WHERE id = ?").run(tailId)
    setText(db, headId, text, ", verified = ?, page_end = ?").run(text, JSON.stringify(doc), verified ? 1 : 0, pageEnd, headId)
    shiftIdx(db, head.chapter_id, tail.idx, -1)
    return {
      result: segOut(db, headId),
      forward: { headId, tailId, doc, text, verified, pageEnd, offset },
      inverse: { name: "splitSegment", params: { id: headId, offset, tailId } },
      segmentIds: [headId, tailId],
    }
  },

  mergeWithNext(db, { id }) {
    const cur = getSegment(db, id)
    const next = db.prepare("SELECT * FROM segment WHERE chapter_id = ? AND idx = ?").get(cur.chapter_id, cur.idx + 1)
    if (!next) throw httpError(400, "no following segment in this chapter")
    const mergedDoc = mergeDocs(JSON.parse(cur.source_doc), JSON.parse(next.source_doc))
    const text = docText(mergedDoc)
    const shift = cur.source_text.length + 1
    const movedNoteIds = db.prepare("SELECT id FROM note WHERE segment_id = ?").all(next.id).map((r) => r.id)
    const movedCommentIds = db.prepare("SELECT id FROM comment WHERE segment_id = ?").all(next.id).map((r) => r.id)
    const headBoxes = boxesOf(db, id)
    const nextBoxes = boxesOf(db, next.id)
    db.prepare("UPDATE note SET segment_id = ?, src_start = src_start + ?, src_end = src_end + ? WHERE segment_id = ?").run(id, shift, shift, next.id)
    db.prepare("UPDATE comment SET segment_id = ? WHERE segment_id = ?").run(id, next.id)
    db.prepare("DELETE FROM segment_version WHERE segment_id = ?").run(next.id)
    db.prepare("DELETE FROM segment WHERE id = ?").run(next.id)
    setText(db, id, text, ", page_end = ?, verified = 0").run(text, JSON.stringify(mergedDoc), next.page_end, id)
    shiftIdx(db, cur.chapter_id, next.idx, -1) // close the gap
    setBoxes(db, id, unionBoxes(headBoxes, nextBoxes))
    return {
      result: segOut(db, id),
      forward: { id },
      inverse: {
        name: "unmerge",
        params: {
          headId: id,
          head: { doc: JSON.parse(cur.source_doc), text: cur.source_text, pageEnd: cur.page_end, verified: cur.verified === 1, boxes: headBoxes },
          next: { ...next }, // full row, restored under its original id
          nextBoxes, movedNoteIds, movedCommentIds, shift,
        },
      },
      segmentIds: [id, next.id],
    }
  },

  unmerge(db, { headId, head, next, nextBoxes = [], movedNoteIds, movedCommentIds, shift }) {
    const cur = getSegment(db, headId)
    shiftIdx(db, cur.chapter_id, cur.idx, 1)
    const cols = Object.keys(next)
    db.prepare(`INSERT INTO segment(${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`).run(...cols.map((c) => next[c]))
    setText(db, headId, head.text, ", page_end = ?, verified = ?").run(head.text, JSON.stringify(head.doc), head.pageEnd, head.verified ? 1 : 0, headId)
    const noteBack = db.prepare("UPDATE note SET segment_id = ?, src_start = src_start - ?, src_end = src_end - ? WHERE id = ?")
    for (const nid of movedNoteIds) noteBack.run(next.id, shift, shift, nid)
    const commentBack = db.prepare("UPDATE comment SET segment_id = ? WHERE id = ?")
    for (const cid of movedCommentIds) commentBack.run(next.id, cid)
    if (head.boxes) setBoxes(db, headId, head.boxes)
    setBoxes(db, next.id, nextBoxes)
    return {
      result: segOut(db, headId),
      forward: { headId, head, next, nextBoxes, movedNoteIds, movedCommentIds, shift },
      inverse: { name: "mergeWithNext", params: { id: headId } },
      segmentIds: [headId, next.id],
    }
  },

  /** Insert a new segment after `afterIdx` in a chapter (afterIdx -1 = first). `id` is pinned on redo. */
  insertSegment(db, { id, chapterId, afterIdx, kind, text, pageNo }) {
    if (!KINDS.includes(kind)) throw httpError(400, "bad kind")
    if (!text?.trim()) throw httpError(400, "text is required")
    const ch = db.prepare("SELECT id FROM chapter WHERE id = ?").get(chapterId)
    if (!ch) throw httpError(404, `chapter ${chapterId} not found`)
    shiftIdx(db, chapterId, afterIdx, 1)
    const newId = db.prepare(
      `INSERT INTO segment(id, chapter_id, idx, kind, page_start, page_end, ocr_text, source_doc, source_text, verified)
       VALUES (?,?,?,?,?,?,NULL,?,?,0)`,
    ).run(id ?? null, chapterId, afterIdx + 1, kind, pageNo, pageNo, pmDoc(text), text).lastInsertRowid
    return {
      result: segOut(db, Number(newId)),
      forward: { id: Number(newId), chapterId, afterIdx, kind, text, pageNo },
      inverse: { name: "deleteSegment", params: { id: Number(newId) } },
      segmentIds: [Number(newId)],
    }
  },

  /** Delete a segment that has no notes or comments (only ones the editor created). Inverse re-inserts it under its id. */
  deleteSegment(db, { id }) {
    const cur = getSegment(db, id)
    const attached = db.prepare("SELECT (SELECT count(*) FROM note WHERE segment_id = ?) + (SELECT count(*) FROM comment WHERE segment_id = ?) n").get(id, id).n
    if (attached) throw httpError(400, "segment has notes or comments; merge instead")
    db.prepare("DELETE FROM segment_version WHERE segment_id = ?").run(id)
    db.prepare("DELETE FROM segment WHERE id = ?").run(id)
    shiftIdx(db, cur.chapter_id, cur.idx, -1)
    return {
      result: null,
      forward: { id },
      inverse: {
        name: "insertSegment",
        params: { id, chapterId: cur.chapter_id, afterIdx: cur.idx - 1, kind: cur.kind, text: cur.source_text, pageNo: cur.page_start },
      },
      segmentIds: [id],
    }
  },

  /** Replace the docs of several segments at once (used by find & replace). One log row; inverse restores all. */
  setDocs(db, { items }) {
    const prev = []
    for (const { id, doc } of items) {
      const cur = getSegment(db, id)
      checkDoc(doc)
      prev.push({ id, doc: JSON.parse(cur.source_doc) })
      setText(db, id, docText(doc)).run(docText(doc), JSON.stringify(doc), id)
    }
    return {
      result: { changed: items.length },
      forward: { items },
      inverse: { name: "setDocs", params: { items: prev } },
      segmentIds: items.map((i) => i.id),
    }
  },

  /** Mark a word as correct for this book. Stored in the glossary (translation filled in later). */
  addGlossaryWord(db, { bookId, term }) {
    if (!term?.trim()) throw httpError(400, "term is required")
    const cur = db.prepare("SELECT id FROM glossary WHERE book_id = ? AND term = ?").get(bookId, term)
    if (cur) throw httpError(400, "already in the dictionary")
    const id = db.prepare("INSERT INTO glossary(book_id, term, translation, kind) VALUES (?,?,'','other')").run(bookId, term).lastInsertRowid
    return { result: { id: Number(id), term }, forward: { bookId, term }, inverse: { name: "removeGlossaryWord", params: { bookId, term } }, segmentIds: [] }
  },
  /** Set (or create) a glossary entry's translation, aliases and kind. Inverse restores the previous row,
   *  or removes the entry if it did not exist. */
  setGlossaryTerm(db, { bookId, term, translation = "", aliases = "", kind = "other" }) {
    if (!term?.trim()) throw httpError(400, "term is required")
    if (!["person", "place", "org", "work", "other"].includes(kind)) throw httpError(400, "bad kind")
    const cur = db.prepare("SELECT * FROM glossary WHERE book_id = ? AND term = ?").get(bookId, term)
    if (cur) {
      db.prepare("UPDATE glossary SET translation = ?, aliases = ?, kind = ? WHERE id = ?").run(translation, aliases, kind, cur.id)
    } else {
      db.prepare("INSERT INTO glossary(book_id, term, translation, aliases, kind) VALUES (?,?,?,?,?)").run(bookId, term, translation, aliases, kind)
    }
    const row = glossaryRow(db, bookId, term)
    return {
      result: row,
      forward: { bookId, term, translation, aliases, kind },
      inverse: cur
        ? { name: "setGlossaryTerm", params: { bookId, term, translation: cur.translation, aliases: cur.aliases ?? "", kind: cur.kind } }
        : { name: "removeGlossaryWord", params: { bookId, term } },
      segmentIds: [],
    }
  },
  removeGlossaryWord(db, { bookId, term }) {
    const cur = db.prepare("SELECT * FROM glossary WHERE book_id = ? AND term = ?").get(bookId, term)
    if (!cur) throw httpError(404, "not in the dictionary")
    db.prepare("DELETE FROM glossary WHERE id = ?").run(cur.id)
    const inverse = cur.translation || cur.aliases
      ? { name: "setGlossaryTerm", params: { bookId, term, translation: cur.translation, aliases: cur.aliases ?? "", kind: cur.kind } }
      : { name: "addGlossaryWord", params: { bookId, term } }
    return { result: null, forward: { bookId, term }, inverse, segmentIds: [] }
  },

  // ---- comments (work notes, never exported). Replies carry parentId.
  // author: "translator" (the editor's route) or "agent" (the fitz tool); a comment keeps it through undo and redo
  addComment(db, { id, segmentId, side, anchor, body, parentId = null, resolved = false, author = "translator", createdAt }) {
    if (!["source", "target"].includes(side)) throw httpError(400, "bad side")
    if (!body?.trim()) throw httpError(400, "body is required")
    getSegment(db, segmentId)
    const newId = db.prepare(
      `INSERT INTO comment(id, segment_id, side, parent_id, src_exact, src_prefix, src_suffix, src_start, src_end, body, resolved, author, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?, coalesce(?, datetime('now')))`,
    ).run(id ?? null, segmentId, side, parentId, ...anchorCols("src", anchor), body, resolved ? 1 : 0, author, createdAt ?? null).lastInsertRowid
    return {
      result: commentRow(getComment(db, newId)),
      forward: { id: Number(newId), segmentId, side, anchor, body, parentId, resolved, author, createdAt: getComment(db, newId).created_at },
      inverse: { name: "deleteComment", params: { id: Number(newId) } },
      segmentIds: [segmentId],
    }
  },
  setComment(db, { id, body, resolved }) {
    const cur = getComment(db, id)
    const next = { body: body ?? cur.body, resolved: resolved ?? cur.resolved === 1 }
    if (!next.body.trim()) throw httpError(400, "body is required")
    db.prepare("UPDATE comment SET body = ?, resolved = ? WHERE id = ?").run(next.body, next.resolved ? 1 : 0, id)
    return {
      result: commentRow(getComment(db, id)),
      forward: { id, ...next },
      inverse: { name: "setComment", params: { id, body: cur.body, resolved: cur.resolved === 1 } },
      segmentIds: [cur.segment_id],
    }
  },
  /** Deleting a thread root deletes its replies too (cascade); the inverse re-creates all of them under their ids. */
  deleteComment(db, { id }) {
    const cur = getComment(db, id)
    const replies = db.prepare("SELECT * FROM comment WHERE parent_id = ? ORDER BY id").all(id)
    db.prepare("DELETE FROM comment WHERE id = ?").run(id)
    const restore = [cur, ...replies].map((r) => ({
      id: r.id, segmentId: r.segment_id, side: r.side, parentId: r.parent_id ?? null, body: r.body, resolved: r.resolved === 1,
      anchor: anchorOf(r, "src"), author: r.author, createdAt: r.created_at,
    }))
    return {
      result: null,
      forward: { id },
      inverse: { name: "restoreComments", params: { rows: restore } },
      segmentIds: [cur.segment_id],
    }
  },
  restoreComments(db, { rows }) {
    for (const r of rows) COMMANDS.addComment(db, r)
    return { result: null, forward: { rows }, inverse: { name: "deleteComment", params: { id: rows[0].id } }, segmentIds: [rows[0].segmentId] }
  },

  // ---- translator's notes (exported as footnotes) and target anchors for any note
  addNote(db, { id, segmentId, anchor, body, createdAt }) {
    if (!body?.trim()) throw httpError(400, "body is required")
    getSegment(db, segmentId)
    const newId = db.prepare(
      `INSERT INTO note(id, segment_id, kind, tgt_exact, tgt_prefix, tgt_suffix, tgt_start, tgt_end, body_target, anchored, created_at)
       VALUES (?,?,'translator',?,?,?,?,?,?,1, coalesce(?, datetime('now')))`,
    ).run(id ?? null, segmentId, ...anchorCols("tgt", anchor), body, createdAt ?? null).lastInsertRowid
    const row = getNote(db, newId)
    return {
      result: noteRow(row),
      forward: { id: Number(newId), segmentId, anchor, body, createdAt: row.created_at },
      inverse: { name: "deleteNote", params: { id: Number(newId) } },
      segmentIds: [segmentId],
    }
  },
  /** Body (translator) and target anchor (any kind) of a note. */
  setNote(db, { id, body, targetAnchor }) {
    const cur = getNote(db, id)
    const nextBody = body ?? cur.body_target
    const nextAnchor = targetAnchor === undefined ? anchorOf(cur, "tgt") : targetAnchor
    if (cur.kind === "translator" && !nextBody?.trim()) throw httpError(400, "body is required")
    db.prepare("UPDATE note SET body_target = ?, tgt_exact = ?, tgt_prefix = ?, tgt_suffix = ?, tgt_start = ?, tgt_end = ? WHERE id = ?")
      .run(nextBody, ...anchorCols("tgt", nextAnchor), id)
    return {
      result: noteRow(getNote(db, id)),
      forward: { id, body: nextBody, targetAnchor: nextAnchor },
      inverse: { name: "setNote", params: { id, body: cur.body_target, targetAnchor: anchorOf(cur, "tgt") } },
      segmentIds: [cur.segment_id],
    }
  },
  deleteNote(db, { id }) {
    const cur = getNote(db, id)
    if (cur.kind !== "translator") throw httpError(400, "author notes cannot be deleted; unlink them instead")
    db.prepare("DELETE FROM note WHERE id = ?").run(id)
    return {
      result: null,
      forward: { id },
      inverse: { name: "addNote", params: { id, segmentId: cur.segment_id, anchor: anchorOf(cur, "tgt"), body: cur.body_target, createdAt: cur.created_at } },
      segmentIds: [cur.segment_id],
    }
  },

  setNoteAnchor(db, { noteId, segmentId, anchored }) {
    const cur = getNote(db, noteId)
    getSegment(db, segmentId)
    const r = db.prepare("UPDATE note SET segment_id = ?, anchored = ? WHERE id = ? RETURNING *").get(segmentId, anchored ? 1 : 0, noteId)
    return {
      result: noteRow(r),
      forward: { noteId, segmentId, anchored },
      inverse: { name: "setNoteAnchor", params: { noteId, segmentId: cur.segment_id, anchored: cur.anchored === 1 } },
      segmentIds: [segmentId, cur.segment_id],
    }
  },

  // ---- Claude's suggestions, decided by the translator
  /** accept: the quoted words replaced in the paragraph as it is now — refused if they are no longer there exactly
   *  once; comment: the suggestion kept as Claude's comment on those words (on the paragraph, if they are gone);
   *  dismiss: nothing more. One step, so ⌘Z takes back the decision and what it did together. */
  decideSuggestion(db, { id, decision, commentId, createdAt }) {
    if (!Object.hasOwn(DECIDED, decision)) throw httpError(400, "decision must be accept, dismiss or comment")
    const s = getSuggestion(db, id)
    if (s.status !== "open") throw httpError(409, `suggestion ${id} is already ${s.status}`)
    const seg = getSegment(db, s.segment_id)
    const text = (s.side === "source" ? seg.source_text : seg.target_text) ?? ""
    const at = findOnce(text, s.quote)
    let did = null  // what it did to the book: that command's inverse is part of this one's
    if (decision === "accept") {
      if (at === -1) throw httpError(409, `¶${seg.id} changed: "${s.quote}" is no longer in it exactly once`)
      const next = replaceRange(JSON.parse(s.side === "source" ? seg.source_doc : seg.target_doc), at, at + s.quote.length, s.replacement)
      did = COMMANDS.updateSegment(db, s.side === "source" ? { id: seg.id, doc: next } : { id: seg.id, targetDoc: next })
    } else if (decision === "comment") {
      const anchor = at === -1 ? null : makeAnchor(text, at, at + s.quote.length)
      did = COMMANDS.addComment(db, { id: commentId, segmentId: seg.id, side: s.side, anchor, body: `${s.quote} → ${s.replacement}\n${s.why}`, author: "agent", createdAt })
    }
    db.prepare("UPDATE agent_suggestion SET status = ? WHERE id = ?").run(DECIDED[decision], id)
    return {
      result: suggestionRow(getSuggestion(db, id)),
      // redo makes the same comment again, under the same id, as addComment's own redo does
      forward: { id, decision, ...(decision === "comment" && { commentId: did.result.id, createdAt: did.result.createdAt }) },
      inverse: { name: "reopenSuggestion", params: { id, undo: did?.inverse ?? null } },
      segmentIds: [seg.id],
    }
  },
  reopenSuggestion(db, { id, undo }) {
    const s = getSuggestion(db, id)
    if (undo) COMMANDS[undo.name](db, undo.params)
    db.prepare("UPDATE agent_suggestion SET status = 'open' WHERE id = ?").run(id)
    const decision = Object.keys(DECIDED).find((d) => DECIDED[d] === s.status)
    return { result: suggestionRow(getSuggestion(db, id)), forward: { id, undo }, inverse: { name: "decideSuggestion", params: { id, decision } }, segmentIds: [s.segment_id] }
  },
}

export const inTransaction = (db, fn) => {
  db.exec("BEGIN")
  try {
    const out = fn()
    db.exec("COMMIT")
    return out
  } catch (e) {
    db.exec("ROLLBACK")
    throw e
  }
}

const run = (db, name, params) => {
  const cmd = COMMANDS[name]
  if (!cmd) throw httpError(404, `unknown command ${name}`)
  return cmd(db, params)
}

const summary = (row) => ({ id: row.id, name: row.name, segmentIds: JSON.parse(row.segment_ids), actor: row.actor })

/** Run a command as a new user action: log it, discard the redo stack, mark the db edited. */
// The book has more than one writer (the editor's routes, the agent's tools): whoever wrote, everyone following the
// book hears about it once the write is committed. Every write goes through execute/undo/redo, so none is missed.
const watchers = new WeakMap()  // db → Set<(change) => void>
/** change: { opId, name, segmentIds, kind: "do" | "undo" | "redo", actor }. Returns the function that stops watching. */
export const watchChanges = (db, fn) => {
  if (!watchers.has(db)) watchers.set(db, new Set())
  watchers.get(db).add(fn)
  return () => watchers.get(db).delete(fn)
}
const announce = (db, change) => {
  for (const fn of watchers.get(db) ?? []) {
    try { fn(change) } catch (e) { console.error("change watcher failed:", e) }  // a watcher never undoes a committed write
  }
}

/** Who made a change is known by the door it came in through (docs/agent.md §16): the editor's HTTP routes are the
 *  translator's; the fitz tools are the agent's, with the id of the tool call that made it. */
export const TRANSLATOR = Object.freeze({ actor: "translator" })

export const execute = (db, name, params, by = TRANSLATOR) => {
  let change
  const result = inTransaction(db, () => {
    const { result, forward, inverse, segmentIds } = run(db, name, params)
    db.prepare("DELETE FROM ops WHERE undone = 1").run()
    const { lastInsertRowid } = db.prepare("INSERT INTO ops(name, params, inverse_name, inverse_params, segment_ids, actor, tool_use_id) VALUES (?,?,?,?,?,?,?)")
      .run(name, JSON.stringify(forward), inverse.name, JSON.stringify(inverse.params), JSON.stringify(segmentIds), by.actor, by.toolUseId ?? null)
    touch(db)
    change = { opId: Number(lastInsertRowid), name, segmentIds, kind: "do", actor: by.actor }
    return result
  })
  announce(db, change)
  return result
}

export const undo = (db) => {
  const op = inTransaction(db, () => {
    const row = db.prepare("SELECT * FROM ops WHERE undone = 0 ORDER BY id DESC LIMIT 1").get()
    if (!row) return null
    run(db, row.inverse_name, JSON.parse(row.inverse_params))
    db.prepare("UPDATE ops SET undone = 1 WHERE id = ?").run(row.id)
    touch(db)
    return summary(row)
  })
  if (op) announce(db, { opId: op.id, name: op.name, segmentIds: op.segmentIds, kind: "undo", actor: op.actor })
  return op
}

export const redo = (db) => {
  const op = inTransaction(db, () => {
    const row = db.prepare("SELECT * FROM ops WHERE undone = 1 ORDER BY id ASC LIMIT 1").get()
    if (!row) return null
    run(db, row.name, JSON.parse(row.params))
    db.prepare("UPDATE ops SET undone = 0 WHERE id = ?").run(row.id)
    touch(db)
    return summary(row)
  })
  if (op) announce(db, { opId: op.id, name: op.name, segmentIds: op.segmentIds, kind: "redo", actor: op.actor })
  return op
}

export const getBook = (db) => {
  const b = db.prepare("SELECT id, title, author FROM book ORDER BY id LIMIT 1").get()
  return { id: b.id, title: b.title, author: b.author }
}

/** Chapters in book order with their progress counts. */
export const listChapters = (db) =>
  db.prepare(`SELECT c.id, c.idx, c.title, c.start_page, count(s.id) n, coalesce(sum(s.verified), 0) v,
                     coalesce(sum(s.status IN ('reviewed','final')), 0) t
              FROM chapter c LEFT JOIN segment s ON s.chapter_id = c.id GROUP BY c.id ORDER BY c.idx`).all()
    .map((r) => ({ id: r.id, idx: r.idx, title: r.title, startPage: r.start_page, segmentCount: r.n, verifiedCount: r.v, confirmedCount: r.t }))

/** Segments whose text contains `query` (case-sensitive, literal), book order. */
export const search = (db, { query }) => {
  if (!query) return []
  return db.prepare(`SELECT s.id, s.chapter_id, c.title, s.page_start, s.source_text, s.source_doc
                     FROM segment s JOIN chapter c ON c.id = s.chapter_id
                     WHERE instr(s.source_text, ?) > 0 ORDER BY c.idx, s.idx`).all(query)
    .map((r) => {
      const at = r.source_text.indexOf(query)
      return {
        segmentId: r.id, chapterId: r.chapter_id, chapterTitle: r.title, pageStart: r.page_start,
        count: r.source_text.split(query).length - 1,
        snippet: r.source_text.slice(Math.max(0, at - 40), at + query.length + 40),
      }
    })
}

/** Apply a literal replacement across the whole book as one undoable command. */
export const replaceAll = (db, { query, replacement }) => {
  if (!query) throw httpError(400, "query is required")
  const items = []
  let occurrences = 0
  for (const r of search(db, { query })) {
    const { doc, count } = replaceInDoc(JSON.parse(getSegment(db, r.segmentId).source_doc), query, replacement)
    if (!docText(doc).trim()) throw httpError(400, `replacement would empty segment ${r.segmentId}`)
    occurrences += count
    items.push({ id: r.segmentId, doc })
  }
  if (!items.length) return { segments: 0, occurrences: 0 }
  execute(db, "setDocs", { items })
  return { segments: items.length, occurrences }
}

const glossaryRow = (db, bookId, term) => {
  const r = db.prepare("SELECT * FROM glossary WHERE book_id = ? AND term = ?").get(bookId, term)
  return r && { id: r.id, term: r.term, translation: r.translation, aliases: r.aliases ?? "", kind: r.kind }
}

/** Glossary entries with how many segments mention each term (whole word, case-insensitive). */
export const listGlossary = (db, { bookId }) => {
  const rows = db.prepare("SELECT * FROM glossary WHERE book_id = ? ORDER BY term COLLATE NOCASE").all(bookId)
  if (!rows.length) return []
  const texts = db.prepare(`SELECT s.id, s.chapter_id, s.source_text FROM segment s JOIN chapter c ON c.id = s.chapter_id ORDER BY c.idx, s.idx`).all()
  return rows.map((r) => {
    const re = new RegExp(`(^|[^A-Za-z])${r.term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=$|[^A-Za-z])`, "i")
    let occurrences = 0
    let first = null
    for (const t of texts) if (re.test(t.source_text)) { occurrences++; first ??= { segmentId: t.id, chapterId: t.chapter_id } }
    return { id: r.id, term: r.term, translation: r.translation, aliases: r.aliases ?? "", kind: r.kind, occurrences, first }
  })
}

/** Everything attached to a chapter's segments: comments (with replies) and notes of both kinds. */
export const listAnnotations = (db, { chapterId }) => ({
  comments: db.prepare(`SELECT c.* FROM comment c JOIN segment s ON s.id = c.segment_id WHERE s.chapter_id = ? ORDER BY c.id`).all(chapterId).map(commentRow),
  notes: db.prepare(`SELECT n.* FROM note n JOIN segment s ON s.id = n.segment_id WHERE s.chapter_id = ? ORDER BY s.idx, n.tgt_start, n.id`).all(chapterId).map(noteRow),
})

/** The open suggestions on a chapter, in book order. */
export const listSuggestions = (db, { chapterId }) =>
  db.prepare(`SELECT a.* FROM agent_suggestion a JOIN segment s ON s.id = a.segment_id
              WHERE s.chapter_id = ? AND a.status = 'open' ORDER BY s.idx, a.id`).all(chapterId).map(suggestionRow)

export const listOps = (db, { segmentId, limit = 50 } = {}) => {
  const rows = segmentId
    ? db.prepare("SELECT * FROM ops WHERE segment_ids LIKE ? ORDER BY id DESC LIMIT ?").all(`%${Number(segmentId)}%`, limit)
    : db.prepare("SELECT * FROM ops ORDER BY id DESC LIMIT ?").all(limit)
  return rows
    .map((r) => {
      const o = { ...summary(r), undone: r.undone === 1, createdAt: r.created_at, before: null, after: null }
      if (r.name === "updateSegment") {
        // text before/after this edit; inverse holds the previous values
        const before = JSON.parse(r.inverse_params).text
        const after = JSON.parse(r.params).text
        if (before !== after) Object.assign(o, { before, after })
      }
      return o
    })
    .filter((o) => !segmentId || o.segmentIds.includes(Number(segmentId)))
}
