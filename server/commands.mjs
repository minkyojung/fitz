// Command layer over book.db. Every write goes through execute(), which runs one command in a
// transaction, logs it (with its inverse) to `ops`, and marks the database edited.
// undo() applies the inverse of the last logged command; redo() re-applies a stored forward command.
import { DatabaseSync } from "node:sqlite"

export const KINDS = ["paragraph", "heading", "blockquote", "caption", "verse"]
export const STATUSES = ["untranslated", "draft", "reviewed", "final"]

export const httpError = (status, message) => Object.assign(new Error(message), { status })

export const openDb = (path) => {
  const db = new DatabaseSync(path)
  db.exec("PRAGMA foreign_keys = ON")
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
  verified: r.verified === 1, status: r.status,
})
export const noteRow = (r) => ({
  id: r.id, segmentId: r.segment_id, kind: r.kind, origPage: r.orig_page, origQuote: r.orig_quote,
  bodySource: r.body_source, anchored: r.anchored === 1,
})

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
  updateSegment(db, { id, text, doc, kind, verified, targetDoc, status }) {
    const cur = getSegment(db, id)
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
  removeGlossaryWord(db, { bookId, term }) {
    const cur = db.prepare("SELECT * FROM glossary WHERE book_id = ? AND term = ?").get(bookId, term)
    if (!cur) throw httpError(404, "not in the dictionary")
    db.prepare("DELETE FROM glossary WHERE id = ?").run(cur.id)
    return { result: null, forward: { bookId, term }, inverse: { name: "addGlossaryWord", params: { bookId, term } }, segmentIds: [] }
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
}

const inTransaction = (db, fn) => {
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

const summary = (row) => ({ id: row.id, name: row.name, segmentIds: JSON.parse(row.segment_ids) })

/** Run a command as a new user action: log it, discard the redo stack, mark the db edited. */
export const execute = (db, name, params) =>
  inTransaction(db, () => {
    const { result, forward, inverse, segmentIds } = run(db, name, params)
    db.prepare("DELETE FROM ops WHERE undone = 1").run()
    db.prepare("INSERT INTO ops(name, params, inverse_name, inverse_params, segment_ids) VALUES (?,?,?,?,?)")
      .run(name, JSON.stringify(forward), inverse.name, JSON.stringify(inverse.params), JSON.stringify(segmentIds))
    touch(db)
    return result
  })

export const undo = (db) =>
  inTransaction(db, () => {
    const row = db.prepare("SELECT * FROM ops WHERE undone = 0 ORDER BY id DESC LIMIT 1").get()
    if (!row) return null
    run(db, row.inverse_name, JSON.parse(row.inverse_params))
    db.prepare("UPDATE ops SET undone = 1 WHERE id = ?").run(row.id)
    touch(db)
    return summary(row)
  })

export const redo = (db) =>
  inTransaction(db, () => {
    const row = db.prepare("SELECT * FROM ops WHERE undone = 1 ORDER BY id ASC LIMIT 1").get()
    if (!row) return null
    run(db, row.name, JSON.parse(row.params))
    db.prepare("UPDATE ops SET undone = 0 WHERE id = ?").run(row.id)
    touch(db)
    return summary(row)
  })

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
