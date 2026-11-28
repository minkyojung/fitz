// Writing to a book: every change is a logged command, taken back and done again by whoever made it.
// The rules are the prototype's (its commands.test.mjs), with this app's floor under undo (docs/data-contract.md §5).
import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { after, before, describe, test } from "node:test"

import type { Doc, Segment } from "../shared/protocol.ts"
import { RequestError } from "./book.ts"
import { openWriter, type By, type Writer } from "./commands.ts"
import { LATEST } from "./migrate.ts"
import { bookCopy } from "./testing.ts"

const ROOT = resolve(import.meta.dirname, "..")
const SCHEMA = readFileSync(join(ROOT, "db/schema.sql"), "utf8")
const CLAUDE: By = { actor: "agent", toolUseId: "toolu_test" }

const doc = (...paragraphs: string[]): Doc => ({ type: "doc", content: paragraphs.map((text) => ({ type: "paragraph", content: text ? [{ type: "text", text }] : [] })) })
const refused = (status: number, message?: string | RegExp) => (e: unknown) =>
  e instanceof RequestError && e.status === status && (message === undefined || (typeof message === "string" ? e.message === message : message.test(e.message)))

describe("writing to a book", () => {
  let dir: string
  let n = 0
  const open: { writer: Writer; sql: DatabaseSync }[] = []
  before(() => { dir = mkdtempSync(join(tmpdir(), "fitz-commands-")) })
  after(() => {
    for (const o of open) { o.writer.close(); o.sql.close() }
    rmSync(dir, { recursive: true, force: true })
  })

  /** A small book at this app's version: four paragraphs, the second with a translation. `sql` is a second connection for looking. */
  const fixture = () => {
    const path = join(dir, `book-${n++}.db`)
    const db = new DatabaseSync(path)
    db.exec(SCHEMA)
    db.exec(`PRAGMA user_version = ${LATEST}; PRAGMA journal_mode = WAL`)
    db.exec("INSERT INTO meta(key, value) VALUES ('undo_floor', '0')")
    db.exec("INSERT INTO book(id, title, source_pdf) VALUES (1, 'A Book', '/nowhere.pdf')")
    db.exec("INSERT INTO chapter(id, book_id, idx, title) VALUES (1, 1, 0, 'One')")
    const insert = db.prepare("INSERT INTO segment(id, chapter_id, idx, page_start, page_end, source_doc, source_text, target_doc, target_text, status) VALUES (?, 1, ?, 1, 1, ?, ?, ?, ?, ?)")
    const texts = ["alpha", "alpha beta gamma delta", "epsilon zeta", "eta theta"]
    texts.forEach((text, i) => insert.run(i + 1, i, JSON.stringify(doc(text)), text, i === 1 ? JSON.stringify(doc("알파 베타")) : null, i === 1 ? "알파 베타" : null, i === 1 ? "draft" : "untranslated"))
    db.close()
    const writer = openWriter(path)
    const sql = new DatabaseSync(path, { readOnly: true })
    open.push({ writer, sql })
    const row = (id: number) => ({ ...sql.prepare("SELECT * FROM segment WHERE id = ?").get(id) })
    const count = (query: string) => Number(Object.values(sql.prepare(query).get() ?? {})[0])
    const update = (params: Record<string, unknown>, by?: By) => writer.execute("updateSegment", params, by) as Segment
    /** Everything but what every write moves: the version and the time. */
    const content = (id: number) => { const { version: _v, updated_at: _u, ...rest } = row(id); return rest }
    return { path, writer, sql, row, count, update, content }
  }

  test("a first translation moves the status to draft, clearing it moves back, and earlier translations are kept", () => {
    const { update, count, writer } = fixture()
    const r1 = update({ id: 3, targetDoc: doc("엡실론 제타") })
    assert.equal(r1.status, "draft")
    assert.equal(r1.targetText, "엡실론 제타")
    assert.deepEqual(r1.targetDoc, doc("엡실론 제타"))
    assert.equal(count("SELECT count(*) FROM segment_version WHERE segment_id = 3"), 0, "nothing to keep yet")
    update({ id: 3, targetDoc: doc("엡실론 제타 다시") })
    assert.equal(count("SELECT count(*) FROM segment_version WHERE segment_id = 3"), 1)
    assert.equal(update({ id: 3, status: "final" }).status, "final")
    const cleared = update({ id: 3, targetDoc: null })
    assert.equal(cleared.status, "untranslated")
    assert.equal(cleared.targetText, null)
    assert.equal(cleared.targetDoc, null)
    assert.equal(update({ id: 3, targetDoc: doc("  ") }).status, "untranslated", "blank is not a translation")
    assert.throws(() => update({ id: 3, status: "done" }), refused(400))
    writer.undo()
    assert.equal(count("SELECT status = 'untranslated' FROM segment WHERE id = 3"), 1)
  })

  test("the translation's plain text is its paragraphs joined by a newline; the source is one paragraph", () => {
    const { update, row } = fixture()
    assert.equal(update({ id: 1, targetDoc: doc("하나", "둘", "셋") }).targetText, "하나\n둘\n셋")
    assert.equal(row(1).target_text, "하나\n둘\n셋")
    const italic: Doc = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Moby-" }, { type: "text", text: "Dick", marks: [{ type: "italic" }] }] }] }
    const marked = update({ id: 1, doc: italic, text: "ignored when a doc is sent" })
    assert.equal(marked.sourceText, "Moby-Dick")
    assert.deepEqual(marked.sourceDoc, italic)
    assert.equal(update({ id: 1, text: "plain again" }).sourceText, "plain again")
    assert.deepEqual(JSON.parse(String(row(1).source_doc)), doc("plain again"))
    assert.throws(() => update({ id: 1, doc: doc("one", "two") }), refused(400, /single paragraph/))
    assert.throws(() => update({ id: 1, doc: { type: "doc", content: [{ type: "heading", content: [] }] } }), refused(400))
    assert.throws(() => update({ id: 1, targetDoc: { type: "doc", content: [] } }), refused(400))
    assert.throws(() => update({ id: 1, kind: "poem" }), refused(400))
  })

  test("do, undo, redo: the paragraph goes forward, back to what it was, and forward again", () => {
    const { update, content, writer } = fixture()
    const was = content(2)
    update({ id: 2, text: "changed", targetDoc: doc("바뀜"), kind: "blockquote", verified: true, status: "reviewed" })
    const is = content(2)
    assert.notDeepEqual(is, was)
    assert.deepEqual({ source_text: is.source_text, target_text: is.target_text, kind: is.kind, verified: is.verified, status: is.status }, { source_text: "changed", target_text: "바뀜", kind: "blockquote", verified: 1, status: "reviewed" })
    assert.deepEqual(writer.undo(), { id: 1, name: "updateSegment", segmentIds: [2], actor: "translator" })
    assert.deepEqual(content(2), was)
    assert.deepEqual(writer.redo(), { id: 1, name: "updateSegment", segmentIds: [2], actor: "translator" })
    assert.deepEqual(content(2), is)
  })

  test("every change gives the paragraph a new, higher version — undo and redo too", () => {
    const { update, row, writer } = fixture()
    const v0 = Number(row(3).version)
    const v1 = update({ id: 3, targetDoc: doc("엡실론") }).version
    assert.ok(v1 > v0)
    assert.equal(row(3).version, v1)
    writer.undo()
    const v2 = Number(row(3).version)
    assert.ok(v2 > v1, "undo is a change too: a new number, not the old one back")
    writer.redo()
    assert.ok(Number(row(3).version) > v2)
    assert.equal(Number(row(4).version), 4, "another paragraph's version does not move")
  })

  test("a write that expects an older version is refused and writes nothing; one that expects the current goes through", () => {
    const { update, row, count, content } = fixture()
    const seen = Number(row(3).version)
    update({ id: 3, status: "draft" }, CLAUDE) // someone else, meanwhile
    const before = content(3)
    assert.throws(() => update({ id: 3, text: "overwritten", expectVersion: seen }), refused(409, "paragraph 3 changed since it was read"))
    assert.deepEqual(content(3), before)
    assert.equal(count("SELECT count(*) FROM ops"), 1)
    assert.equal(update({ id: 3, text: "epsilon zeta!", expectVersion: Number(row(3).version) }).sourceText, "epsilon zeta!")
  })

  test("redo of a write made with an expected version does not depend on that version", () => {
    const { update, row, writer, sql } = fixture()
    update({ id: 3, text: "first", expectVersion: Number(row(3).version) })
    assert.ok(!String(sql.prepare("SELECT params FROM ops").get()?.params).includes("expectVersion"), "it is not part of the logged command")
    writer.undo()
    assert.ok(writer.redo())
    assert.equal(row(3).source_text, "first")
  })

  test("a save that changes nothing is not a change: no log row, no new version", () => {
    const { update, row, count, writer } = fixture()
    const v = Number(row(2).version)
    const same = update({ id: 2, text: "alpha beta gamma delta", targetDoc: doc("알파 베타"), status: "draft", kind: "paragraph", verified: false })
    assert.equal(same.version, v)
    assert.equal(update({ id: 2 }).version, v)
    assert.equal(count("SELECT count(*) FROM ops"), 0)
    assert.equal(count("SELECT count(*) FROM segment_version"), 0)
    assert.equal(writer.revision(), 0)
    assert.equal(writer.undo(), null)
  })

  test("a command that fails leaves no log row and no change", () => {
    const { update, content, count, writer } = fixture()
    const before = content(2)
    assert.throws(() => update({ id: 2, text: "new", status: "done" }), refused(400))
    assert.throws(() => update({ id: 99, text: "nobody" }), refused(404, "paragraph 99 not found"))
    assert.throws(() => writer.execute("dropEverything", {}), refused(404))
    assert.throws(() => writer.execute("toString", {}), refused(404))
    assert.throws(() => update({ id: "2", text: "x" }), refused(400))
    assert.throws(() => update({ id: 2, nonsense: true }), refused(400))
    assert.deepEqual(content(2), before)
    assert.equal(count("SELECT count(*) FROM ops"), 0)
    assert.equal(count("SELECT count(*) FROM segment_version"), 0)
    assert.equal(writer.revision(), 0)
  })

  test("the log row holds the command and its inverse as the prototype wrote them", () => {
    const { update, sql } = fixture()
    update({ id: 3, targetDoc: doc("엡실론") })
    const op = sql.prepare("SELECT * FROM ops").get()!
    assert.deepEqual({ name: op.name, inverse_name: op.inverse_name, segment_ids: op.segment_ids, actor: op.actor, tool_use_id: op.tool_use_id, undone: op.undone },
      { name: "updateSegment", inverse_name: "updateSegment", segment_ids: "[3]", actor: "translator", tool_use_id: null, undone: 0 })
    assert.deepEqual(JSON.parse(String(op.params)), { id: 3, doc: doc("epsilon zeta"), text: "epsilon zeta", kind: "paragraph", verified: false, targetDoc: doc("엡실론"), status: "draft" })
    assert.deepEqual(JSON.parse(String(op.inverse_params)), { id: 3, doc: doc("epsilon zeta"), text: "epsilon zeta", kind: "paragraph", verified: false, targetDoc: null, status: "untranslated" })
    assert.match(String(sql.prepare("SELECT value FROM meta WHERE key = 'last_edit_at'").get()?.value), /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/)
  })

  test("a change is the translator's unless it says otherwise; Claude's carries its tool call", () => {
    const { update, sql } = fixture()
    update({ id: 3, status: "draft" })
    update({ id: 4, status: "draft" }, { actor: "agent", toolUseId: "toolu_X" })
    assert.deepEqual(sql.prepare("SELECT actor, tool_use_id FROM ops ORDER BY id").all().map((r) => [r.actor, r.tool_use_id]), [["translator", null], ["agent", "toolu_X"]])
    assert.throws(() => update({ id: 3, status: "reviewed" }, { actor: "someone" } as unknown as By))
    assert.equal(sql.prepare("SELECT status FROM segment WHERE id = 3").get()?.status, "draft", "the refused change wrote nothing")
  })

  test("undo and redo are each writer's own, and return null when there is nothing", () => {
    const { update, writer, row } = fixture()
    assert.equal(writer.undo(), null)
    assert.equal(writer.redo(), null)
    update({ id: 4, status: "draft" }, CLAUDE)
    assert.equal(writer.undo(), null, "the translator's undo does not take back Claude's change")
    assert.equal(row(4).status, "draft")
    assert.equal(writer.undo(CLAUDE)?.actor, "agent")
    assert.equal(row(4).status, "untranslated")
    assert.equal(writer.redo(), null)
    assert.equal(writer.redo(CLAUDE)?.actor, "agent")
    assert.equal(row(4).status, "draft")
  })

  test("a new change ends its own writer's redo, and only that", () => {
    const { update, writer, count, row } = fixture()
    update({ id: 3, text: "Claude's ¶3" }, CLAUDE)
    writer.undo(CLAUDE)
    update({ id: 1, verified: true })
    writer.undo()
    assert.equal(count("SELECT count(*) FROM ops WHERE undone = 1"), 2)
    update({ id: 4, verified: true })
    assert.equal(count("SELECT count(*) FROM ops WHERE undone = 1"), 1)
    assert.equal(writer.redo(), null, "the translator's new change ended the translator's redo")
    assert.deepEqual(writer.redo(CLAUDE)?.segmentIds, [3], "but not Claude's")
    assert.equal(row(3).source_text, "Claude's ¶3")
  })

  test("undo is refused when a later change, still standing, touched the same paragraph; nothing is written", () => {
    const { update, writer, content, count, row } = fixture()
    update({ id: 2, text: "mine" })
    update({ id: 2, text: "Claude's over mine" }, CLAUDE)
    const before = content(2)
    assert.throws(() => writer.undo(), refused(409, "Claude changed ¶2 after this"))
    assert.deepEqual(content(2), before)
    assert.equal(count("SELECT count(*) FROM ops WHERE undone = 1"), 0)
    // once Claude's change is taken back, the translator's goes too
    assert.equal(writer.undo(CLAUDE)?.actor, "agent")
    assert.equal(writer.undo()?.actor, "translator")
    assert.equal(row(2).source_text, "alpha beta gamma delta")
    // and the other way round
    update({ id: 3, text: "Claude's" }, CLAUDE)
    update({ id: 3, text: "mine over Claude's" })
    assert.throws(() => writer.undo(CLAUDE), refused(409, "You changed ¶3 after this"))
    update({ id: 4, text: "elsewhere" }, CLAUDE)
    assert.equal(writer.undo(CLAUDE)?.segmentIds[0], 4, "a later change to another paragraph does not stand in the way")
  })

  test("redo is refused over a later change to the same paragraph", () => {
    const { update, writer } = fixture()
    update({ id: 2, text: "mine" })
    writer.undo()
    update({ id: 2, text: "Claude's" }, CLAUDE)
    assert.throws(() => writer.redo(), refused(409, "Claude changed ¶2 after this"))
  })

  test("the revision counts changes that were made: do, undo and redo, not refusals", () => {
    const { update, writer } = fixture()
    assert.equal(writer.revision(), 0)
    update({ id: 3, status: "draft" })
    assert.equal(writer.revision(), 1)
    writer.undo()
    assert.equal(writer.revision(), 2)
    writer.redo()
    assert.equal(writer.revision(), 3)
    assert.throws(() => update({ id: 3, status: "done" }))
    assert.equal(writer.undo(CLAUDE), null)
    assert.equal(writer.revision(), 3)
  })

  test("a book that is not at this app's version is not written to", () => {
    for (const version of [0, LATEST + 1]) {
      const path = join(dir, `other-v${version}.db`)
      const db = new DatabaseSync(path)
      db.exec(SCHEMA)
      db.exec(`PRAGMA user_version = ${version}`)
      db.close()
      assert.throws(() => openWriter(path), new RegExp(`book version ${version}`))
    }
    assert.throws(() => openWriter(join(dir, "missing.db")), /no book database/)
  })
})

describe("the floor under undo: changes made before this app are history only", () => {
  let dir: string
  let writer: Writer
  let sql: DatabaseSync
  let floor: number
  before(async () => {
    dir = mkdtempSync(join(tmpdir(), "fitz-floor-"))
    const { path } = await bookCopy(dir, "migrated")
    writer = openWriter(path)
    sql = new DatabaseSync(path, { readOnly: true })
    floor = Number(sql.prepare("SELECT value FROM meta WHERE key = 'undo_floor'").get()?.value)
  })
  after(() => {
    writer?.close()
    sql?.close()
    rmSync(dir, { recursive: true, force: true })
  })
  const old = () => sql.prepare("SELECT count(*) n, sum(undone) undone, max(id) top FROM ops WHERE id <= ?").get(floor)

  test("the real book has a history, and none of it can be undone or redone", () => {
    assert.ok(floor > 0, "the copy has changes from the prototype")
    assert.deepEqual({ ...old() }, { n: floor, undone: 0, top: floor })
    const before = sql.prepare("SELECT id, version, source_text, target_text, status FROM segment ORDER BY id").all()
    assert.equal(writer.undo(), null)
    assert.equal(writer.undo(CLAUDE), null)
    assert.equal(writer.redo(), null)
    assert.equal(writer.redo(CLAUDE), null)
    assert.deepEqual(sql.prepare("SELECT id, version, source_text, target_text, status FROM segment ORDER BY id").all(), before)
    assert.equal(writer.revision(), 0)
  })

  test("a change made now is undone; the one before it, from the prototype, is not", () => {
    const target = sql.prepare("SELECT id, target_text FROM segment WHERE target_doc IS NOT NULL ORDER BY id LIMIT 1").get()!
    const id = Number(target.id)
    writer.execute("updateSegment", { id, targetDoc: doc("새 앱에서 고친 번역") })
    assert.equal(Number(sql.prepare("SELECT max(id) m FROM ops").get()?.m), floor + 1)
    assert.deepEqual(writer.undo(), { id: floor + 1, name: "updateSegment", segmentIds: [id], actor: "translator" })
    assert.equal(sql.prepare("SELECT target_text FROM segment WHERE id = ?").get(id)?.target_text, target.target_text)
    assert.equal(writer.undo(), null, "nothing below the floor is taken back")
    assert.deepEqual({ ...old() }, { n: floor, undone: 0, top: floor })

    // a new change after an undo ends the redo — and removes only this app's undone row, never the prototype's
    writer.execute("updateSegment", { id, targetDoc: doc("다시 고친 번역") })
    assert.deepEqual({ ...old() }, { n: floor, undone: 0, top: floor })
    assert.equal(Number(sql.prepare("SELECT count(*) n FROM ops WHERE id > ?").get(floor)?.n), 1)
    assert.ok(writer.undo())
    assert.equal(sql.prepare("SELECT target_text FROM segment WHERE id = ?").get(id)?.target_text, target.target_text)
  })
})
