// Reading a book's database. Nothing here writes: the file is opened read-only, and every row is checked against
// the protocol before it leaves — a row that is not as docs/data-contract.md says is an error, never a guess.
import { existsSync } from "node:fs"
import { DatabaseSync } from "node:sqlite"

import { z } from "zod"

import { Book, Chapter, REQUESTS, Segment, isRequestName, type RequestName, type Result } from "../shared/protocol.ts"
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
    const segmentRows = db.prepare(
      `SELECT id, chapter_id, idx, kind, page_start, page_end, source_text, source_doc, target_text, target_doc,
              status, verified, version
       FROM segment WHERE chapter_id = ? ORDER BY idx`,
    )

    /** `what` as the protocol has it, or an error naming it: the database holds something the contract does not allow. */
    const checked = <S extends z.ZodType>(schema: S, what: string, make: () => unknown): z.infer<S> => {
      try {
        return schema.parse(make())
      } catch (e) {
        const why = e instanceof z.ZodError ? z.prettifyError(e) : e instanceof Error ? e.message : String(e)
        throw new Error(`${what} is not as the data contract says: ${why}`, { cause: e })
      }
    }

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
        return segmentRows.all(chapterId).map((r) =>
          checked(Segment, `paragraph ${r.id}`, () => ({
            id: r.id, chapterId: r.chapter_id, idx: r.idx, kind: r.kind, pageStart: r.page_start, pageEnd: r.page_end,
            sourceText: r.source_text, sourceDoc: JSON.parse(String(r.source_doc)),
            targetText: r.target_text, targetDoc: r.target_doc === null ? null : JSON.parse(String(r.target_doc)),
            status: r.status, verified: r.verified === 1, version: r.version,
          })),
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

/** A request by its name, with what was sent checked against the protocol first. */
export function answer<N extends RequestName>(book: BookReader, name: N, params: unknown): Result<N>
export function answer(book: BookReader, name: string, params: unknown): unknown
export function answer(book: BookReader, name: string, params: unknown): unknown {
  if (!isRequestName(name)) throw new RequestError(404, `unknown request ${name}`)
  const sent = REQUESTS[name].params.safeParse(params)
  if (!sent.success) throw new RequestError(400, `${name}: ${z.prettifyError(sent.error)}`)
  switch (name) {
    case "getBook":
      return book.getBook()
    case "listChapters":
      return book.listChapters()
    case "listSegments":
      return book.listSegments(REQUESTS.listSegments.params.parse(params).chapterId)
  }
}
