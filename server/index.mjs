// Temporary local API over out/book.db for the dev UI. Replaced by Tauri commands later.
// usage: node server/index.mjs [--db out/book.db] [--pages out/pages] [--port 4800]
import { createServer } from "node:http"
import { readFile } from "node:fs/promises"
import { resolve, basename } from "node:path"
import { DatabaseSync } from "node:sqlite"

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? dflt : process.argv[i + 1]
}
const DB = resolve(arg("db", "out/book.db"))
const PAGES = resolve(arg("pages", "out/pages"))
const PORT = Number(arg("port", 4800))

const db = new DatabaseSync(DB)
db.exec("PRAGMA foreign_keys = ON")

const pmDoc = (text) =>
  JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: text ? [{ type: "text", text }] : [] }] })

const segRow = (r) => ({
  id: r.id, chapterId: r.chapter_id, idx: r.idx, kind: r.kind, pageStart: r.page_start, pageEnd: r.page_end,
  sourceText: r.source_text, verified: r.verified === 1, status: r.status,
})
const noteRow = (r) => ({
  id: r.id, segmentId: r.segment_id, kind: r.kind, origPage: r.orig_page, origQuote: r.orig_quote,
  bodySource: r.body_source, anchored: r.anchored === 1,
})
const getSegment = (id) => {
  const r = db.prepare("SELECT * FROM segment WHERE id = ?").get(id)
  if (!r) throw httpError(404, `segment ${id} not found`)
  return r
}
const httpError = (status, message) => Object.assign(new Error(message), { status })
// Shift idx of segments after `afterIdx` by `delta`. Goes through negative values so UNIQUE(chapter_id, idx)
// never collides mid-update (SQLite has no ORDER BY on UPDATE).
const shiftIdx = (chapterId, afterIdx, delta) => {
  db.prepare("UPDATE segment SET idx = -(idx + ?) WHERE chapter_id = ? AND idx > ?").run(delta, chapterId, afterIdx)
  db.prepare("UPDATE segment SET idx = -idx WHERE chapter_id = ? AND idx < 0").run(chapterId)
}

const routes = {
  listChapters: () =>
    db.prepare(`SELECT c.id, c.idx, c.title, c.start_page, count(s.id) n, coalesce(sum(s.verified), 0) v
                FROM chapter c LEFT JOIN segment s ON s.chapter_id = c.id GROUP BY c.id ORDER BY c.idx`).all()
      .map((r) => ({ id: r.id, idx: r.idx, title: r.title, startPage: r.start_page, segmentCount: r.n, verifiedCount: r.v })),

  listSegments: ({ chapterId }) =>
    db.prepare("SELECT * FROM segment WHERE chapter_id = ? ORDER BY idx").all(chapterId).map(segRow),

  listPages: () =>
    db.prepare("SELECT page_no, pdf_index, image_path FROM page ORDER BY pdf_index").all()
      .map((r) => ({ pageNo: r.page_no, pdfIndex: r.pdf_index, imageUrl: `/pages/${basename(r.image_path)}` })),

  updateSegment: ({ id, patch }) => {
    const cur = getSegment(id)
    const text = patch.sourceText ?? cur.source_text
    const kind = patch.kind ?? cur.kind
    const verified = patch.verified ?? cur.verified === 1
    if (!["paragraph", "heading", "blockquote", "caption", "verse"].includes(kind)) throw httpError(400, "bad kind")
    db.prepare(`UPDATE segment SET source_text = ?, source_doc = ?, kind = ?, verified = ?, updated_at = datetime('now')
                WHERE id = ?`).run(text, pmDoc(text), kind, verified ? 1 : 0, id)
    return segRow(getSegment(id))
  },

  splitSegment: ({ id, offset }) => {
    const cur = getSegment(id)
    const head = cur.source_text.slice(0, offset).trim()
    const tail = cur.source_text.slice(offset).trim()
    if (!head || !tail) throw httpError(400, "split would create an empty segment")
    db.exec("BEGIN")
    try {
      shiftIdx(cur.chapter_id, cur.idx, 1)  // open a slot for the tail
      db.prepare("UPDATE segment SET source_text = ?, source_doc = ?, updated_at = datetime('now') WHERE id = ?").run(head, pmDoc(head), id)
      const tailId = db.prepare(`INSERT INTO segment(chapter_id, idx, kind, page_start, page_end, source_doc, source_text, verified)
                                 VALUES (?,?,?,?,?,?,?,0)`)
        .run(cur.chapter_id, cur.idx + 1, cur.kind, cur.page_end, cur.page_end, pmDoc(tail), tail).lastInsertRowid
      // notes whose anchor lies in the tail move with it
      db.prepare("UPDATE note SET segment_id = ?, src_start = src_start - ?, src_end = src_end - ? WHERE segment_id = ? AND src_start >= ?")
        .run(tailId, offset, offset, id, offset)
      db.exec("COMMIT")
      return [segRow(getSegment(id)), segRow(getSegment(tailId))]
    } catch (e) { db.exec("ROLLBACK"); throw e }
  },

  mergeWithNext: ({ id }) => {
    const cur = getSegment(id)
    const next = db.prepare("SELECT * FROM segment WHERE chapter_id = ? AND idx = ?").get(cur.chapter_id, cur.idx + 1)
    if (!next) throw httpError(400, "no following segment in this chapter")
    const text = `${cur.source_text} ${next.source_text}`
    const shift = cur.source_text.length + 1
    db.exec("BEGIN")
    try {
      db.prepare("UPDATE note SET segment_id = ?, src_start = src_start + ?, src_end = src_end + ? WHERE segment_id = ?").run(id, shift, shift, next.id)
      db.prepare("UPDATE comment SET segment_id = ? WHERE segment_id = ?").run(id, next.id)
      db.prepare("DELETE FROM segment_version WHERE segment_id = ?").run(next.id)
      db.prepare("DELETE FROM segment WHERE id = ?").run(next.id)
      db.prepare("UPDATE segment SET source_text = ?, source_doc = ?, page_end = ?, verified = 0, updated_at = datetime('now') WHERE id = ?")
        .run(text, pmDoc(text), next.page_end, id)
      shiftIdx(cur.chapter_id, next.idx, -1)  // close the gap
      db.exec("COMMIT")
      return segRow(getSegment(id))
    } catch (e) { db.exec("ROLLBACK"); throw e }
  },

  listUnanchoredNotes: () => db.prepare("SELECT * FROM note WHERE anchored = 0 ORDER BY id").all().map(noteRow),

  anchorNote: ({ noteId, segmentId }) => {
    getSegment(segmentId)
    const r = db.prepare("UPDATE note SET segment_id = ?, anchored = 1 WHERE id = ? RETURNING *").get(segmentId, noteId)
    if (!r) throw httpError(404, `note ${noteId} not found`)
    return noteRow(r)
  },
}

const json = (res, status, body) => {
  res.writeHead(status, { "content-type": "application/json", "access-control-allow-origin": "*",
    "access-control-allow-headers": "content-type", "access-control-allow-methods": "POST, GET, OPTIONS" })
  res.end(JSON.stringify(body))
}

createServer(async (req, res) => {
  try {
    if (req.method === "OPTIONS") return json(res, 204, null)
    if (req.method === "GET" && req.url.startsWith("/pages/")) {
      const file = basename(req.url)  // basename defeats path traversal
      const png = await readFile(resolve(PAGES, file))
      res.writeHead(200, { "content-type": "image/png", "cache-control": "max-age=86400", "access-control-allow-origin": "*" })
      return res.end(png)
    }
    const m = req.url.match(/^\/api\/(\w+)$/)
    if (!m || req.method !== "POST" || !(m[1] in routes)) return json(res, 404, { error: "not found" })
    let body = ""
    for await (const chunk of req) body += chunk
    const result = routes[m[1]](body ? JSON.parse(body) : {})
    json(res, 200, result)
  } catch (e) {
    json(res, e.status ?? 500, { error: e.message })
  }
}).listen(PORT, () => console.log(`api  http://localhost:${PORT}/api/*   db=${DB}`))
