// Temporary local HTTP API over out/book.db for the dev UI. Replaced by Tauri commands later.
// usage: node server/index.mjs [--db out/book.db] [--pages out/pages] [--port 4800]
import { createServer } from "node:http"
import { readFile } from "node:fs/promises"
import { resolve, basename } from "node:path"

import { buildManuscript, exportFilename } from "./export.mjs"
import { renderDocx } from "./docx.mjs"
import { createAgentHost } from "./agent/host.mjs"
import { attachAgentSocket } from "./agent/socket.mjs"
import { execute, getBook, listAnnotations, listChapters, listGlossary, listOps, noteRow, openDb, redo, replaceAll, search, segOut, segRow, undo } from "./commands.mjs"

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? dflt : process.argv[i + 1]
}
const DB = resolve(arg("db", "out/book.db"))
const PAGES = resolve(arg("pages", "out/pages"))
const PORT = Number(arg("port", 4800))

const db = openDb(DB)

const routes = {
  // reads
  getBook: () => getBook(db),
  listChapters: () => listChapters(db),
  listSegments: ({ chapterId }) => {
    const boxes = new Map()
    for (const b of db.prepare(`SELECT b.* FROM segment_box b JOIN segment s ON s.id = b.segment_id
                                WHERE s.chapter_id = ? ORDER BY b.page_no`).all(chapterId)) {
      if (!boxes.has(b.segment_id)) boxes.set(b.segment_id, [])
      boxes.get(b.segment_id).push({ pageNo: b.page_no, x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1 })
    }
    return db.prepare("SELECT * FROM segment WHERE chapter_id = ? ORDER BY idx").all(chapterId)
      .map((r) => ({ ...segRow(r), boxes: boxes.get(r.id) ?? [] }))
  },
  listPages: () =>
    db.prepare("SELECT page_no, pdf_index, image_path FROM page ORDER BY pdf_index").all()
      .map((r) => ({ pageNo: r.page_no, pdfIndex: r.pdf_index, imageUrl: `/pages/${basename(r.image_path)}` })),
  listUnanchoredNotes: () => db.prepare("SELECT * FROM note WHERE anchored = 0 ORDER BY id").all().map(noteRow),
  listOps: (p) => listOps(db, p),
  listAnnotations: ({ chapterId }) => listAnnotations(db, { chapterId }),
  /** Words the person marked as correct (the book's dictionary / glossary terms). */
  listGlossary: ({ bookId }) => listGlossary(db, { bookId }),
  listGlossaryWords: ({ bookId }) => db.prepare("SELECT term FROM glossary WHERE book_id = ? ORDER BY term").all(bookId).map((r) => r.term),
  /** Every segment's text, for the client-side language model. */
  listSourceTexts: () => db.prepare("SELECT id, source_text FROM segment").all().map((r) => ({ id: r.id, text: r.source_text })),
  search: (p) => search(db, p),
  /** Export: the manuscript's chapters, warnings and stats; and the Word file itself (a Buffer result is sent as a download). */
  exportSummary: ({ chapterIds, scheme }) => {
    const m = buildManuscript(db, { chapterIds, scheme })
    return { chapters: m.chapters.map(({ id, idx, title, segments, untranslated, unplaced, chars }) => ({ id, idx, title, segments, untranslated, unplaced, chars })), warnings: m.warnings, stats: m.stats, filename: exportFilename(m) }
  },
  exportDocx: async ({ chapterIds, scheme }) => {
    const m = buildManuscript(db, { chapterIds, scheme })
    return { file: await renderDocx(m), filename: exportFilename(m) }
  },

  // writes: every one is a logged command
  updateSegment: ({ id, patch }) =>
    execute(db, "updateSegment", {
      id, text: patch.sourceText, doc: patch.sourceDoc, kind: patch.kind, verified: patch.verified,
      targetDoc: patch.targetDoc, status: patch.status,
    }),
  splitSegment: ({ id, offset }) => execute(db, "splitSegment", { id, offset }),
  mergeWithNext: ({ id }) => execute(db, "mergeWithNext", { id }),
  anchorNote: ({ noteId, segmentId }) => execute(db, "setNoteAnchor", { noteId, segmentId, anchored: true }),
  insertSegment: ({ chapterId, afterIdx, kind, text, pageNo }) => execute(db, "insertSegment", { chapterId, afterIdx, kind, text, pageNo }),
  deleteSegment: ({ id }) => execute(db, "deleteSegment", { id }),
  replaceAll: ({ query, replacement }) => replaceAll(db, { query, replacement }),
  addGlossaryWord: ({ bookId, term }) => execute(db, "addGlossaryWord", { bookId, term }),
  setGlossaryTerm: ({ bookId, term, translation, aliases, kind }) => execute(db, "setGlossaryTerm", { bookId, term, translation, aliases, kind }),
  addComment: ({ segmentId, side, anchor, body, parentId }) => execute(db, "addComment", { segmentId, side, anchor, body, parentId }),
  setComment: ({ id, body, resolved }) => execute(db, "setComment", { id, body, resolved }),
  deleteComment: ({ id }) => execute(db, "deleteComment", { id }),
  addNote: ({ segmentId, anchor, body }) => execute(db, "addNote", { segmentId, anchor, body }),
  setNote: ({ id, body, targetAnchor }) => execute(db, "setNote", { id, body, targetAnchor }),
  deleteNote: ({ id }) => execute(db, "deleteNote", { id }),
  undo: () => undo(db),
  redo: () => redo(db),
}

const json = (res, status, body) => {
  res.writeHead(status, { "content-type": "application/json", "access-control-allow-origin": "*",
    "access-control-allow-headers": "content-type", "access-control-allow-methods": "POST, GET, OPTIONS" })
  res.end(JSON.stringify(body))
}

const server = createServer(async (req, res) => {
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
    const result = await routes[m[1]](body ? JSON.parse(body) : {})
    if (result && Buffer.isBuffer(result.file)) {
      res.writeHead(200, {
        "content-type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(result.filename)}`,
        "access-control-allow-origin": "*", "access-control-expose-headers": "content-disposition",
      })
      return res.end(result.file)
    }
    json(res, 200, result ?? null)
  } catch (e) {
    json(res, e.status ?? 500, { error: e.message })
  }
})

// the translation agent (docs/agent.md): one socket, the server owns every Claude Code process
const agent = createAgentHost({ db })
attachAgentSocket(server, agent)
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => { agent.close(); process.exit(0) })

server.listen(PORT, () => {
  console.log(`api  http://localhost:${PORT}/api/*   db=${DB}`)
  // an API key in the environment is used without asking, over the Claude login
  console.log(`agent ws://localhost:${PORT}/agent   ${process.env.ANTHROPIC_API_KEY ? "ANTHROPIC_API_KEY from the environment" : "the Claude login on this Mac"}`)
})
