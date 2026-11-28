// Reading a book's database. Nothing here writes: the file is opened read-only, and every row is checked against
// the protocol before it leaves — a row that is not as docs/data-contract.md says is an error, never a guess.
import { existsSync } from "node:fs"
import { basename } from "node:path"
import { DatabaseSync } from "node:sqlite"

import { z } from "zod"

import { Book, Chapter, Page, Segment } from "../shared/protocol.ts"
import { LATEST } from "./migrate.ts"

/** A request that cannot be answered as asked: 400 for what was sent, 404 for what is not there. */
export class RequestError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = "RequestError"
    this.status = status
  }
}

/** The database file, opened so that it cannot be written. A file that is not there is not created. */
export function openReadOnly(path: string): DatabaseSync {
  if (!existsSync(path)) throw new Error(`no book database at ${path}`)
  return new DatabaseSync(path, { readOnly: true })
}

/** `what` as the protocol has it, or an error naming it: the database holds something the contract does not allow. */
const checked = <S extends z.ZodType>(schema: S, what: string, make: () => unknown): z.infer<S> => {
  try {
    return schema.parse(make())
  } catch (e) {
    const why = e instanceof z.ZodError ? z.prettifyError(e) : e instanceof Error ? e.message : String(e)
    throw new Error(`${what} is not as the data contract says: ${why}`, { cause: e })
  }
}

/** Paragraphs with their draft, if one is kept. Followed by a WHERE on `s`. */
const SEGMENT_ROWS = `
  SELECT s.id, s.chapter_id, s.idx, s.kind, s.page_start, s.page_end, s.source_text, s.source_doc, s.ocr_text, s.target_text,
         s.target_doc, s.status, s.verified, s.version,
         ds.doc AS source_draft_doc, ds.base_version AS source_draft_base, ds.saved_at AS source_draft_saved,
         dt.doc AS target_draft_doc, dt.base_version AS target_draft_base, dt.saved_at AS target_draft_saved
  FROM segment s
  LEFT JOIN draft ds ON ds.segment_id = s.id AND ds.side = 'source'
  LEFT JOIN draft dt ON dt.segment_id = s.id AND dt.side = 'target'`

/** A row of SEGMENT_ROWS, with its boxes, as the protocol has a paragraph. */
const toSegment = (r: Record<string, unknown>, boxes: Record<string, unknown>[]): Segment =>
  checked(Segment, `paragraph ${r.id}`, () => ({
    id: r.id, chapterId: r.chapter_id, idx: r.idx, kind: r.kind, pageStart: r.page_start, pageEnd: r.page_end,
    sourceText: r.source_text, sourceDoc: JSON.parse(String(r.source_doc)), ocrText: r.ocr_text,
    boxes: boxes.map((b) => ({ pageNo: b.page_no, x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1 })),
    targetText: r.target_text, targetDoc: r.target_doc === null ? null : JSON.parse(String(r.target_doc)),
    status: r.status, verified: r.verified === 1, version: r.version,
    drafts: { source: draftOf(r, "source"), target: draftOf(r, "target") },
  }))
const draftOf = (r: Record<string, unknown>, side: "source" | "target") =>
  r[`${side}_draft_doc`] === null ? null : { doc: JSON.parse(String(r[`${side}_draft_doc`])), baseVersion: r[`${side}_draft_base`], savedAt: r[`${side}_draft_saved`] }

const queries = new WeakMap<DatabaseSync, ReturnType<typeof prepareSegments>>()
function prepareSegments(db: DatabaseSync) {
  const rows = { chapter: db.prepare(`${SEGMENT_ROWS} WHERE s.chapter_id = ? ORDER BY s.idx`), one: db.prepare(`${SEGMENT_ROWS} WHERE s.id = ?`) }
  const boxes = {
    chapter: db.prepare("SELECT b.* FROM segment_box b JOIN segment s ON s.id = b.segment_id WHERE s.chapter_id = ? ORDER BY b.page_no"),
    one: db.prepare("SELECT * FROM segment_box WHERE segment_id = ? ORDER BY page_no"),
  }
  return { rows, boxes }
}

/** Paragraphs as the page is given them — each with its boxes on the scan and its draft — by chapter (in order) or by id. */
export function readSegments(db: DatabaseSync, by: "chapter" | "one", key: number): Segment[] {
  let q = queries.get(db)
  if (!q) queries.set(db, (q = prepareSegments(db)))
  const boxes = new Map<unknown, Record<string, unknown>[]>()
  for (const b of q.boxes[by].all(key)) boxes.set(b.segment_id, [...(boxes.get(b.segment_id) ?? []), b])
  return q.rows[by].all(key).map((r) => toSegment(r, boxes.get(r.id) ?? []))
}

export type BookReader = ReturnType<typeof openBook>

export function openBook(path: string) {
  const db = openReadOnly(path)
  try {
    // per connection, not kept in the file (data contract §1)
    db.exec("PRAGMA foreign_keys = ON")
    // a database from before paragraph versions has no guard against one writer overwriting another: refuse it
    if (!db.prepare("PRAGMA table_info(segment)").all().some((c) => c.name === "version"))
      throw new Error(`${path} has no paragraph versions (segment.version)`)
    // the book is brought to this app's version before it is opened (migrate.ts); anything else is not read
    const version = Number(Object.values(db.prepare("PRAGMA user_version").get() ?? {})[0])
    if (version !== LATEST) throw new Error(`${path} is at book version ${version}, and this app reads version ${LATEST}`)
    const bookRow = db.prepare("SELECT id, title, author FROM book ORDER BY id LIMIT 1")
    const first = bookRow.get()
    if (!first) throw new Error(`${path} has no book in it`)
    const bookId = Number(first.id)

    const chapterRows = db.prepare(
      `SELECT c.id, c.idx, c.title, c.start_page,
              count(s.id) AS segments,
              coalesce(sum(s.target_doc IS NOT NULL), 0) AS translated,
              coalesce(sum(s.status IN ('reviewed', 'final')), 0) AS confirmed,
              coalesce(sum(s.verified = 1), 0) AS verified
       FROM chapter c LEFT JOIN segment s ON s.chapter_id = c.id
       WHERE c.book_id = ? GROUP BY c.id ORDER BY c.idx`,
    )
    const chapterExists = db.prepare("SELECT 1 FROM chapter WHERE id = ? AND book_id = ?")
    const pageRows = db.prepare("SELECT page_no, pdf_index, image_path FROM page WHERE book_id = ? ORDER BY pdf_index")

    return {
      getBook(): Book {
        return checked(Book, "the book", () => {
          const r = bookRow.get()
          return { id: r?.id, title: r?.title, author: r?.author }
        })
      },

      /** Chapters in book order with their counts. */
      listChapters(): Chapter[] {
        return chapterRows.all(bookId).map((r) =>
          checked(Chapter, `chapter ${r.id}`, () => ({
            id: r.id, idx: r.idx, title: r.title, startPage: r.start_page,
            segmentCount: r.segments, translatedCount: r.translated, confirmedCount: r.confirmed, verifiedCount: r.verified,
          })),
        )
      },

      /** A chapter's paragraphs in order. */
      listSegments(chapterId: number): Segment[] {
        if (!chapterExists.get(chapterId, bookId)) throw new RequestError(404, `chapter ${chapterId} not found`)
        return readSegments(db, "chapter", chapterId)
      },

      /** The scanned pages in the order of the PDF. Only the file's name is kept of where the import put the picture:
       *  the server gives it from the book's pages folder (data contract §6). */
      listPages(): Page[] {
        return pageRows.all(bookId).map((r) =>
          checked(Page, `page ${r.page_no}`, () => ({ pageNo: r.page_no, pdfIndex: r.pdf_index, image: `/pages/${encodeURIComponent(basename(String(r.image_path)))}` })),
        )
      },

      close(): void {
        db.close()
      },
    }
  } catch (e) {
    db.close()
    throw e
  }
}
