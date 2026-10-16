// Command layer over book.db. Every write goes through execute(), which runs one command in a
// transaction, logs it (with its inverse) to `ops`, and marks the database edited.
// undo() applies the inverse of the last logged command; redo() re-applies a stored forward command.
import { DatabaseSync } from "node:sqlite"

export const KINDS = ["paragraph", "heading", "blockquote", "caption", "verse"]

export const httpError = (status, message) => Object.assign(new Error(message), { status })

export const openDb = (path) => {
  const db = new DatabaseSync(path)
  db.exec("PRAGMA foreign_keys = ON")
  return db
}

export const pmDoc = (text) =>
  JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: text ? [{ type: "text", text }] : [] }] })

/** Plain text of a ProseMirror doc (single paragraph; text nodes only). */
export const docText = (doc) => {
  const walk = (n) => (n.type === "text" ? n.text ?? "" : (n.content ?? []).map(walk).join(""))
  return walk(doc)
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

/** Validate a doc for our schema: one paragraph of text nodes, optional marks. */
const checkDoc = (doc) => {
  const ok = doc && doc.type === "doc" && Array.isArray(doc.content) && doc.content.length === 1
    && doc.content[0].type === "paragraph"
    && (doc.content[0].content ?? []).every((n) => n.type === "text" && typeof n.text === "string")
  if (!ok) throw httpError(400, "doc must be a single paragraph of text")
}

export const segRow = (r) => ({
  id: r.id, chapterId: r.chapter_id, idx: r.idx, kind: r.kind, pageStart: r.page_start, pageEnd: r.page_end,
  sourceText: r.source_text, sourceDoc: JSON.parse(r.source_doc), ocrText: r.ocr_text ?? null,
  verified: r.verified === 1, status: r.status,
})
export const noteRow = (r) => ({
  id: r.id, segmentId: r.segment_id, kind: r.kind, origPage: r.orig_page, origQuote: r.orig_quote,
  bodySource: r.body_source, anchored: r.anchored === 1,
})

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
  // `doc` (ProseMirror JSON) wins over `text`; text is derived from it so marks survive.
  updateSegment(db, { id, text, doc, kind, verified }) {
    const cur = getSegment(db, id)
    if (doc !== undefined) checkDoc(doc)
    const nextDoc = doc !== undefined ? JSON.stringify(doc) : text !== undefined ? pmDoc(text) : cur.source_doc
    const nextText = doc !== undefined ? docText(doc) : text !== undefined ? text : cur.source_text
    const next = { kind: kind ?? cur.kind, verified: verified ?? cur.verified === 1 }
    if (!KINDS.includes(next.kind)) throw httpError(400, "bad kind")
    db.prepare(`UPDATE segment SET source_text = ?, source_doc = ?, kind = ?, verified = ?, updated_at = datetime('now')
                WHERE id = ?`).run(nextText, nextDoc, next.kind, next.verified ? 1 : 0, id)
    return {
      result: segRow(getSegment(db, id)),
      forward: { id, doc: JSON.parse(nextDoc), text: nextText, ...next },
      inverse: {
        name: "updateSegment",
        params: { id, doc: JSON.parse(cur.source_doc), text: cur.source_text, kind: cur.kind, verified: cur.verified === 1 },
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
    return {
      result: [segRow(getSegment(db, id)), segRow(getSegment(db, newTailId))],
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
      result: segRow(getSegment(db, headId)),
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
    db.prepare("UPDATE note SET segment_id = ?, src_start = src_start + ?, src_end = src_end + ? WHERE segment_id = ?").run(id, shift, shift, next.id)
    db.prepare("UPDATE comment SET segment_id = ? WHERE segment_id = ?").run(id, next.id)
    db.prepare("DELETE FROM segment_version WHERE segment_id = ?").run(next.id)
    db.prepare("DELETE FROM segment WHERE id = ?").run(next.id)
    setText(db, id, text, ", page_end = ?, verified = 0").run(text, JSON.stringify(mergedDoc), next.page_end, id)
    shiftIdx(db, cur.chapter_id, next.idx, -1) // close the gap
    return {
      result: segRow(getSegment(db, id)),
      forward: { id },
      inverse: {
        name: "unmerge",
        params: {
          headId: id,
          head: { doc: JSON.parse(cur.source_doc), text: cur.source_text, pageEnd: cur.page_end, verified: cur.verified === 1 },
          next: { ...next }, // full row, restored under its original id
          movedNoteIds, movedCommentIds, shift,
        },
      },
      segmentIds: [id, next.id],
    }
  },

  unmerge(db, { headId, head, next, movedNoteIds, movedCommentIds, shift }) {
    const cur = getSegment(db, headId)
    shiftIdx(db, cur.chapter_id, cur.idx, 1)
    const cols = Object.keys(next)
    db.prepare(`INSERT INTO segment(${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`).run(...cols.map((c) => next[c]))
    setText(db, headId, head.text, ", page_end = ?, verified = ?").run(head.text, JSON.stringify(head.doc), head.pageEnd, head.verified ? 1 : 0, headId)
    const noteBack = db.prepare("UPDATE note SET segment_id = ?, src_start = src_start - ?, src_end = src_end - ? WHERE id = ?")
    for (const nid of movedNoteIds) noteBack.run(next.id, shift, shift, nid)
    const commentBack = db.prepare("UPDATE comment SET segment_id = ? WHERE id = ?")
    for (const cid of movedCommentIds) commentBack.run(next.id, cid)
    return {
      result: segRow(getSegment(db, headId)),
      forward: { headId, head, next, movedNoteIds, movedCommentIds, shift },
      inverse: { name: "mergeWithNext", params: { id: headId } },
      segmentIds: [headId, next.id],
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
