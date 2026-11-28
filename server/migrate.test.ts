// Migrating a book's database, on throwaway copies of the development copy: the copy in dev-data/ is never changed here.
import assert from "node:assert/strict"
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { after, before, describe, test } from "node:test"

import { LATEST, MIGRATIONS, migrate, type Migration } from "./migrate.ts"
import { bookCopy } from "./testing.ts"

const ROOT = resolve(import.meta.dirname, "..")
const SCHEMA = readFileSync(join(ROOT, "db/schema.sql"), "utf8")

const one = (db: DatabaseSync, sql: string) => Object.values(db.prepare(sql).get() ?? {})[0]
/** Everything a book database holds, as text: each table's rows in order, with the schema. Two databases with the same dump hold the same book. */
function dump(path: string): string {
  const db = new DatabaseSync(path, { readOnly: true })
  try {
    const tables = db.prepare("SELECT name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name").all()
    const rows = tables.filter((t) => String(t.sql).startsWith("CREATE TABLE")).map((t) => [t.name, db.prepare(`SELECT * FROM "${t.name}" ORDER BY rowid`).all()])
    return JSON.stringify({ tables, rows })
  } finally {
    db.close()
  }
}
const state = (path: string) => {
  const db = new DatabaseSync(path, { readOnly: true })
  try {
    return { version: one(db, "PRAGMA user_version"), journal: one(db, "PRAGMA journal_mode"), integrity: one(db, "PRAGMA integrity_check") }
  } finally {
    db.close()
  }
}

describe("migrating a book", () => {
  let dir: string
  let n = 0
  before(() => {
    dir = mkdtempSync(join(tmpdir(), "fitz-migrate-"))
  })
  after(() => rmSync(dir, { recursive: true, force: true }))

  /** A fresh copy of the book as the prototype left it (version 0), in a folder of its own. */
  const fresh = () => bookCopy(join(dir, String(n++)), "prototype")
  const backups = (backupDir: string) => (existsSync(backupDir) ? readdirSync(backupDir) : [])

  test("the book becomes version 1: WAL, with the undo floor at its last change, and nothing else touched", async () => {
    const { path, backupDir } = await fresh()
    assert.deepEqual(state(path), { version: 0, journal: "delete", integrity: "ok" })
    const before = dump(path)
    const sql0 = new DatabaseSync(path, { readOnly: true })
    const lastOp = Number(one(sql0, "SELECT coalesce(max(id), 0) FROM ops"))
    const counts0 = sql0.prepare("SELECT (SELECT count(*) FROM segment) s, (SELECT count(*) FROM ops) o, (SELECT count(*) FROM meta) m, (SELECT max(version) FROM segment) v").get()
    sql0.close()
    assert.ok(lastOp > 0, "the copy has a history of changes")

    const done = await migrate(path, { backupDir })

    assert.equal(done.from, 0)
    assert.equal(done.to, 1)
    assert.equal(LATEST, 1)
    assert.deepEqual(state(path), { version: 1, journal: "wal", integrity: "ok" })
    const db = new DatabaseSync(path, { readOnly: true })
    try {
      assert.equal(one(db, "SELECT value FROM meta WHERE key = 'undo_floor'"), String(lastOp))
      assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), [])
      const counts1 = db.prepare("SELECT (SELECT count(*) FROM segment) s, (SELECT count(*) FROM ops) o, (SELECT count(*) FROM meta) m, (SELECT max(version) FROM segment) v").get()
      assert.deepEqual({ ...counts1 }, { ...counts0, m: Number(counts0?.m) + 1 }, "only meta gained a row; no paragraph version moved")
      assert.equal(one(db, "SELECT count(*) FROM ops WHERE undone <> 0"), 0, "no old change was marked undone")
    } finally {
      db.close()
    }
    // the same book, but for the one new meta row
    const parsed = (text: string) => JSON.parse(text) as { tables: unknown; rows: [string, Record<string, unknown>[]][] }
    const was = parsed(before)
    const is = parsed(dump(path))
    assert.deepEqual(is.tables, was.tables, "the schema is as it was")
    for (const [name, rows] of is.rows) {
      const old = was.rows.find(([t]) => t === name)?.[1]
      assert.deepEqual(name === "meta" ? rows.filter((r) => r.key !== "undo_floor") : rows, old, `table ${name}`)
    }

    // a backup of what was there before, itself a sound database
    assert.ok(done.backup && existsSync(done.backup))
    assert.deepEqual(backups(backupDir).length, 1)
    assert.deepEqual(state(done.backup), { version: 0, journal: "delete", integrity: "ok" })
    assert.equal(dump(done.backup), before)
  })

  test("a book already migrated is left alone, and no backup is made", async () => {
    const { path, backupDir } = await fresh()
    await migrate(path, { backupDir })
    const once = dump(path)
    const again = await migrate(path, { backupDir })
    assert.deepEqual({ from: again.from, to: again.to, backup: again.backup }, { from: 1, to: 1, backup: null })
    assert.equal(dump(path), once)
    assert.equal(backups(backupDir).length, 1)
  })

  test("a step that fails leaves the book as it was", async () => {
    const { path, backupDir } = await fresh()
    const before = dump(path)
    const failing: Migration[] = [{ to: 1, name: "fails half way", up(db) { db.exec("INSERT INTO meta(key, value) VALUES ('half', 'done')"); throw new Error("the step broke") } }]
    await assert.rejects(migrate(path, { backupDir, migrations: failing }), /the step broke/)
    assert.deepEqual(state(path), { version: 0, journal: "delete", integrity: "ok" })
    assert.equal(dump(path), before)
    assert.ok(!existsSync(`${path}-wal`) && !existsSync(`${path}-shm`))
  })

  test("a step that loses rows is caught, and the book is put back from the backup", async () => {
    const { path, backupDir } = await fresh()
    const before = dump(path)
    const losing: Migration[] = [{ to: 1, name: "loses a comment", up(db) { db.exec("DELETE FROM comment WHERE id = (SELECT min(id) FROM comment)") } }]
    await assert.rejects(migrate(path, { backupDir, migrations: losing }), /comment/)
    assert.deepEqual(state(path), { version: 0, journal: "delete", integrity: "ok" })
    assert.equal(dump(path), before)
    assert.equal(backups(backupDir).length, 1, "the backup it was put back from is kept")
  })

  test("a step may say which tables it changes, and only those may change", async () => {
    const { path, backupDir } = await fresh()
    const adding: Migration[] = [{ to: 1, name: "adds a meta row", changes: { meta: 1 }, up(db) { db.exec("INSERT INTO meta(key, value) VALUES ('k', 'v')") } }]
    assert.equal((await migrate(path, { backupDir, migrations: adding })).to, 1)
    const { path: other, backupDir: otherBackups } = await fresh()
    const undeclared: Migration[] = [{ to: 1, name: "adds a meta row unsaid", up(db) { db.exec("INSERT INTO meta(key, value) VALUES ('k', 'v')") } }]
    await assert.rejects(migrate(other, { backupDir: otherBackups, migrations: undeclared }), /meta/)
    assert.equal(state(other).version, 0)
  })

  test("a book from a newer fitz is refused and not touched", async () => {
    const { path, backupDir } = await fresh()
    const db = new DatabaseSync(path)
    db.exec(`PRAGMA user_version = ${LATEST + 1}`)
    db.close()
    const before = dump(path)
    await assert.rejects(migrate(path, { backupDir }), /newer/)
    assert.equal(dump(path), before)
    assert.equal(state(path).version, LATEST + 1)
    assert.equal(backups(backupDir).length, 0)
  })

  test("a database from before paragraph versions is refused and not touched", async () => {
    const path = join(dir, "old.db")
    const db = new DatabaseSync(path)
    db.exec("CREATE TABLE segment (id INTEGER PRIMARY KEY, chapter_id INTEGER, idx INTEGER); CREATE TABLE ops (id INTEGER PRIMARY KEY); CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT)")
    db.close()
    const before = dump(path)
    await assert.rejects(migrate(path, { backupDir: join(dir, "old-backups") }), /version/)
    assert.equal(dump(path), before)
    assert.equal(state(path).version, 0)
  })

  test("a missing file is said plainly and not created", async () => {
    const path = join(dir, "missing.db")
    await assert.rejects(migrate(path, { backupDir: join(dir, "missing-backups") }), (e) => e instanceof Error && e.message.includes(path))
    assert.ok(!existsSync(path))
  })

  test("a new, empty book gets a floor of 0", async () => {
    const path = join(dir, "new.db")
    const db = new DatabaseSync(path)
    db.exec(SCHEMA)
    db.exec("INSERT INTO book(id, title, source_pdf) VALUES (1, 'A Book', '/nowhere.pdf')")
    db.close()
    await migrate(path, { backupDir: join(dir, "new-backups") })
    const after = new DatabaseSync(path, { readOnly: true })
    assert.equal(one(after, "SELECT value FROM meta WHERE key = 'undo_floor'"), "0")
    after.close()
  })

  test("the steps go from 1 to the latest without a gap", () => {
    assert.deepEqual(MIGRATIONS.map((m) => m.to), MIGRATIONS.map((_, i) => i + 1))
    assert.equal(LATEST, MIGRATIONS.length)
  })
})
