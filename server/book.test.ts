// Reading the book, against the development copy of the real one (scripts/dev-data.sh) and small databases built
// from db/schema.sql. What the copy holds is counted here with plain SQL and compared with what book.ts answers,
// so the tests hold for any copy, whenever it was made.
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { after, before, describe, test } from "node:test"

import type { Doc } from "../shared/protocol.ts"
import { answer } from "./answer.ts"
import { RequestError, openBook, openReadOnly } from "./book.ts"
import { openWriter, type Writer } from "./commands.ts"
import { LATEST } from "./migrate.ts"
import { bookCopy } from "./testing.ts"

const ROOT = resolve(import.meta.dirname, "..")
const SCHEMA = readFileSync(join(ROOT, "db/schema.sql"), "utf8")

/** Plain text of a document as the data contract has it: text nodes joined, paragraphs joined by a newline. */
const docText = (doc: Doc) => doc.content.map((p) => (p.content ?? []).map((n) => n.text).join("")).join("\n")
const sha = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex")
const pm = (text: string, marks?: { type: string }[]) =>
  JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text, ...(marks ? { marks } : {}) }] }] })

describe("the development copy of the book", () => {
  let work: string
  let COPY: string
  let sql: DatabaseSync
  let book: ReturnType<typeof openBook>
  let writer: Writer
  let shaBefore: string
  const count = (query: string, ...params: number[]) => Number(Object.values(sql.prepare(query).get(...params) ?? {})[0])

  before(async () => {
    work = mkdtempSync(join(tmpdir(), "fitz-book-copy-"))
    COPY = (await bookCopy(work, "migrated")).path
    shaBefore = sha(COPY)
    sql = new DatabaseSync(COPY, { readOnly: true })
    book = openBook(COPY)
    writer = openWriter(COPY)
  })
  after(() => {
    book?.close()
    writer?.close()
    sql?.close()
    if (work) rmSync(work, { recursive: true, force: true })
  })

  test("chapters, paragraphs and translated paragraphs match the database", (t) => {
    const chapters = book.listChapters()
    const segments = chapters.flatMap((c) => book.listSegments(c.id))
    const translated = segments.filter((s) => s.targetDoc !== null)
    t.diagnostic(`chapters ${chapters.length}, paragraphs ${segments.length}, translated ${translated.length}`)
    assert.ok(chapters.length > 0 && segments.length > 0)
    assert.equal(chapters.length, count("SELECT count(*) FROM chapter"))
    assert.equal(segments.length, count("SELECT count(*) FROM segment"))
    assert.equal(translated.length, count("SELECT count(*) FROM segment WHERE target_doc IS NOT NULL"))
    assert.equal(new Set(segments.map((s) => s.id)).size, segments.length, "no paragraph is listed twice")
  })

  test("the book is the one in the database", () => {
    const row = sql.prepare("SELECT id, title, author FROM book ORDER BY id LIMIT 1").get()
    assert.deepEqual(book.getBook(), { id: row?.id, title: row?.title, author: row?.author })
  })

  test("chapters come in book order with their counts", () => {
    const chapters = book.listChapters()
    assert.deepEqual(chapters.map((c) => c.idx), chapters.map((_, i) => i))
    for (const c of chapters) {
      assert.equal(c.segmentCount, count("SELECT count(*) FROM segment WHERE chapter_id = ?", c.id), `segmentCount of chapter ${c.id}`)
      assert.equal(c.translatedCount, count("SELECT count(*) FROM segment WHERE chapter_id = ? AND target_doc IS NOT NULL", c.id), `translatedCount of chapter ${c.id}`)
      assert.equal(c.confirmedCount, count("SELECT count(*) FROM segment WHERE chapter_id = ? AND status IN ('reviewed','final')", c.id), `confirmedCount of chapter ${c.id}`)
      assert.equal(c.verifiedCount, count("SELECT count(*) FROM segment WHERE chapter_id = ? AND verified = 1", c.id), `verifiedCount of chapter ${c.id}`)
    }
    const titles = sql.prepare("SELECT title FROM chapter ORDER BY idx").all().map((r) => r.title)
    assert.deepEqual(chapters.map((c) => c.title), titles)
  })

  test("a chapter's paragraphs come in order, each with its text", () => {
    for (const c of book.listChapters()) {
      const segments = book.listSegments(c.id)
      assert.equal(segments.length, c.segmentCount)
      assert.deepEqual(segments.map((s) => s.idx), segments.map((_, i) => i), `order in chapter ${c.id}`)
      for (const s of segments) {
        assert.equal(s.chapterId, c.id)
        assert.equal(s.sourceText, docText(s.sourceDoc), `source text of paragraph ${s.id}`)
        if (s.targetDoc === null) {
          assert.equal(s.targetText, null, `paragraph ${s.id} has no translation`)
          assert.equal(s.status, "untranslated")
        } else {
          assert.equal(s.targetText, docText(s.targetDoc), `target text of paragraph ${s.id}`)
        }
      }
    }
  })

  test("a paragraph is what its row holds", () => {
    const row = sql.prepare("SELECT * FROM segment WHERE target_doc IS NOT NULL ORDER BY id LIMIT 1").get()
    assert.ok(row, "the copy has a translated paragraph")
    const found = book.listSegments(Number(row.chapter_id)).find((s) => s.id === row.id)
    assert.deepEqual(found, {
      id: row.id, chapterId: row.chapter_id, idx: row.idx, kind: row.kind, pageStart: row.page_start, pageEnd: row.page_end,
      sourceText: row.source_text, sourceDoc: JSON.parse(String(row.source_doc)),
      targetText: row.target_text, targetDoc: JSON.parse(String(row.target_doc)),
      status: row.status, verified: row.verified === 1, version: row.version,
    })
  })

  test("the database is opened read-only", () => {
    const db = openReadOnly(COPY)
    try {
      assert.throws(() => db.exec("UPDATE meta SET value = value"), /readonly/)
      assert.throws(() => db.exec("CREATE TABLE nope (x)"), /readonly/)
    } finally {
      db.close()
    }
  })

  test("requests are answered by name, with what was sent checked", () => {
    const library = { book, writer }
    const chapters = answer(library, "listChapters", {})
    assert.deepEqual(chapters, book.listChapters())
    assert.deepEqual(answer(library, "getBook", {}), book.getBook())
    const first = book.listChapters()[0]
    assert.ok(first)
    assert.deepEqual(answer(library, "listSegments", { chapterId: first.id }), book.listSegments(first.id))

    const refused = (name: string, params: unknown, status: number) =>
      assert.throws(() => answer(library, name, params), (e) => e instanceof RequestError && e.status === status, `${name} ${JSON.stringify(params)}`)
    refused("listSegments", { chapterId: "1" }, 400)
    refused("listSegments", { chapterId: 1.5 }, 400)
    refused("listSegments", {}, 400)
    refused("listSegments", null, 400)
    refused("getBook", { extra: 1 }, 400)
    refused("dropEverything", {}, 404)
    refused("toString", {}, 404)
    refused("listSegments", { chapterId: 999_999_999 }, 404)
    // a save from the page says which version it saw; one that does not is not taken
    refused("updateSegment", { id: 1, patch: { status: "draft" } }, 400)
    refused("updateSegment", { id: 1, patch: { nonsense: 1 }, expectVersion: 0 }, 400)
    refused("undo", { extra: 1 }, 400)
    assert.equal(writer.revision(), 0, "nothing was written")
  })

  test("reading leaves the file as it was", () => {
    assert.equal(sha(COPY), shaBefore)
    // a WAL database has its -wal and -shm beside it while it is open; a rollback journal would mean a write
    assert.ok(!existsSync(`${COPY}-journal`), "no rollback journal appears beside the database")
  })
})

describe("databases that are not as the contract says", () => {
  let dir: string
  before(() => { dir = mkdtempSync(join(tmpdir(), "fitz-book-")) })
  after(() => rmSync(dir, { recursive: true, force: true }))

  /** A database made from db/schema.sql with one book, one chapter and the paragraphs given. */
  const make = (name: string, docs: { source: string; target?: string }[]) => {
    const path = join(dir, name)
    const db = new DatabaseSync(path)
    db.exec(SCHEMA)
    db.exec(`PRAGMA user_version = ${LATEST}`)
    db.exec("INSERT INTO book(id, title, source_pdf) VALUES (1, 'A Book', '/nowhere.pdf')")
    db.exec("INSERT INTO chapter(id, book_id, idx, title) VALUES (1, 1, 0, 'One')")
    const insert = db.prepare("INSERT INTO segment(chapter_id, idx, page_start, page_end, source_doc, source_text, target_doc, target_text, status) VALUES (1, ?, 1, 1, ?, 'x', ?, ?, ?)")
    docs.forEach((d, i) => insert.run(i, d.source, d.target ?? null, d.target ? "y" : null, d.target ? "draft" : "untranslated"))
    db.close()
    return path
  }

  test("a missing file is said plainly", () => {
    const path = join(dir, "missing.db")
    assert.throws(() => openBook(path), (e) => e instanceof Error && e.message.includes(path))
    assert.ok(!existsSync(path), "opening does not create the file")
  })

  test("a database without paragraph versions is refused", () => {
    const path = join(dir, "old.db")
    const db = new DatabaseSync(path)
    db.exec("CREATE TABLE segment (id INTEGER PRIMARY KEY, chapter_id INTEGER, idx INTEGER)")
    db.close()
    assert.throws(() => openBook(path), /version/)
  })

  test("a book of another version is refused: not yet migrated, or from a newer fitz", () => {
    for (const version of [0, LATEST + 1]) {
      const path = join(dir, `v${version}.db`)
      const db = new DatabaseSync(path)
      db.exec(SCHEMA)
      db.exec(`PRAGMA user_version = ${version}`)
      db.exec("INSERT INTO book(id, title, source_pdf) VALUES (1, 'A Book', '/nowhere.pdf')")
      db.close()
      assert.throws(() => openBook(path), new RegExp(`book version ${version}`))
    }
  })

  test("a book with no book row is refused", () => {
    const path = join(dir, "empty.db")
    const db = new DatabaseSync(path)
    db.exec(SCHEMA)
    db.exec(`PRAGMA user_version = ${LATEST}`)
    db.close()
    assert.throws(() => openBook(path), /no book/)
  })

  test("italic in a paragraph is passed on as it is", () => {
    const book = openBook(make("italic.db", [{ source: pm("Moby-Dick", [{ type: "italic" }]) }]))
    try {
      const [s] = book.listSegments(1)
      assert.deepEqual(s?.sourceDoc.content[0]?.content?.[0], { type: "text", text: "Moby-Dick", marks: [{ type: "italic" }] })
      assert.deepEqual(book.listChapters()[0], { id: 1, idx: 0, title: "One", startPage: null, segmentCount: 1, translatedCount: 0, confirmedCount: 0, verifiedCount: 0 })
    } finally {
      book.close()
    }
  })

  test("a paragraph that is not doc → paragraph → text is an error, not a guess", () => {
    const heading = JSON.stringify({ type: "doc", content: [{ type: "heading", content: [{ type: "text", text: "x" }] }] })
    for (const [name, docs] of [
      ["node.db", [{ source: heading }]],
      ["json.db", [{ source: "not json" }]],
      ["target.db", [{ source: pm("x"), target: heading }]],
    ] as const) {
      const book = openBook(make(name, [...docs]))
      try {
        assert.throws(() => book.listSegments(1), (e) => e instanceof Error && !(e instanceof RequestError) && /paragraph 1/.test(e.message), name)
      } finally {
        book.close()
      }
    }
  })
})
