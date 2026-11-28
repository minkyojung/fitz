// Bringing a book's database up to the version this app writes. Run before the book is opened, every time.
//
// The order is: back up → run the steps → check → on any doubt, put the backup back. A book that cannot be brought
// up is left exactly as it was found (docs/data-contract.md). `PRAGMA user_version` is the book's version;
// the prototype's books are 0.
import { copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs"
import { basename, join } from "node:path"
import { DatabaseSync, backup } from "node:sqlite"

export interface Migration {
  /** The version the book has once this step is done. */
  to: number
  name: string
  /** Tables whose row count this step changes, and by how much. Any other change in a count is taken for damage. */
  changes?: Record<string, number>
  /** Runs inside a transaction; throwing undoes it. */
  up(db: DatabaseSync): void
}

export const MIGRATIONS: Migration[] = [
  {
    // Changes made before this app are history only: undo, redo and Claude's rewind look at changes after this one
    // (the translator's decision, data contract §5). Taken at the moment of moving, since the prototype may still add some.
    to: 1,
    name: "the undo floor",
    changes: { meta: 1 },
    up(db) {
      db.exec("INSERT INTO meta(key, value) VALUES ('undo_floor', (SELECT CAST(coalesce(max(id), 0) AS TEXT) FROM ops))")
    },
  },
  {
    // What is being typed into a translation, kept so that a crash or a refused save loses nothing (one per
    // paragraph). Not a change to the book: never in `ops`, never undone.
    to: 2,
    name: "drafts",
    changes: { draft: 0 },
    up(db) {
      db.exec(`CREATE TABLE draft (
        segment_id   INTEGER PRIMARY KEY REFERENCES segment(id) ON DELETE CASCADE,
        target_doc   TEXT NOT NULL,     -- ProseMirror JSON, as segment.target_doc
        base_version INTEGER NOT NULL,  -- segment.version when the edit began
        saved_at     TEXT NOT NULL DEFAULT (datetime('now'))
      )`)
    },
  },
]
export const LATEST = MIGRATIONS.length

export interface Migrated {
  from: number
  to: number
  /** The backup made before the steps ran; null when there was nothing to do. */
  backup: string | null
}

const one = (db: DatabaseSync, sql: string) => Object.values(db.prepare(sql).get() ?? {})[0]
const tableCounts = (db: DatabaseSync): Map<string, number> =>
  new Map(
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()
      .map((t) => [String(t.name), Number(one(db, `SELECT count(*) FROM "${String(t.name)}"`))]),
  )

/** Why the database is not sound, or null if it is. */
function unsound(db: DatabaseSync, expected: Map<string, number>): string | null {
  const integrity = one(db, "PRAGMA integrity_check")
  if (integrity !== "ok") return `integrity check: ${integrity}`
  const orphans = db.prepare("PRAGMA foreign_key_check").all()
  if (orphans.length) return `${orphans.length} row(s) point at rows that are not there (first in table ${orphans[0]?.table})`
  const counts = tableCounts(db)
  for (const [table, want] of expected) {
    const got = counts.get(table)
    if (got !== want) return `table ${table} has ${got ?? "no"} rows, expected ${want}`
  }
  for (const table of counts.keys()) if (!expected.has(table)) return `table ${table} appeared`
  return null
}

const stamp = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

export async function migrate(
  path: string,
  { backupDir, migrations = MIGRATIONS, now = new Date() }: { backupDir: string; migrations?: Migration[]; now?: Date },
): Promise<Migrated> {
  if (!existsSync(path)) throw new Error(`no book database at ${path}`)
  const latest = migrations.length
  let db = new DatabaseSync(path)
  try {
    db.exec("PRAGMA foreign_keys = ON")
    const from = Number(one(db, "PRAGMA user_version"))
    if (from > latest) throw new Error(`${path} was made by a newer fitz (book version ${from}; this app knows up to ${latest})`)
    // a database from before paragraph versions has no guard against one writer overwriting another
    if (!db.prepare("PRAGMA table_info(segment)").all().some((c) => c.name === "version"))
      throw new Error(`${path} has no paragraph versions (segment.version)`)
    if (from === latest) return { from, to: latest, backup: null }

    // 1. back up, with SQLite's own backup, and make sure the backup holds what the book holds
    mkdirSync(backupDir, { recursive: true })
    let kept = join(backupDir, `${basename(path, ".db")}.v${from}.${stamp(now)}.db`)
    for (let i = 2; existsSync(kept); i++) kept = join(backupDir, `${basename(path, ".db")}.v${from}.${stamp(now)}-${i}.db`)
    await backup(db, kept)
    // A backup of a WAL book is itself in WAL mode, and may hold part of itself in a -wal file beside it. It is made
    // one whole file, so that putting it back is a plain copy of that file.
    const whole = new DatabaseSync(kept)
    try {
      const mode = one(whole, "PRAGMA journal_mode = DELETE")
      if (mode !== "delete") throw new Error(`the backup at ${kept} could not be made one file (journal mode ${mode}); the book was not touched`)
    } finally {
      whole.close()
    }
    const before = tableCounts(db)
    const copy = new DatabaseSync(kept, { readOnly: true })
    try {
      const why = unsound(copy, before)
      if (why) throw new Error(`the backup at ${kept} is not sound (${why}); the book was not touched`)
    } finally {
      copy.close()
    }

    // 2. the steps, each in a transaction of its own with its version
    const expected = new Map(before)
    for (const step of migrations.slice(from)) {
      db.exec("BEGIN IMMEDIATE")
      try {
        step.up(db)
        db.exec(`PRAGMA user_version = ${step.to}`)
        db.exec("COMMIT")
      } catch (e) {
        db.exec("ROLLBACK")
        throw new Error(`migrating ${path} to version ${step.to} (${step.name}) failed: ${e instanceof Error ? e.message : String(e)}`, { cause: e })
      }
      for (const [table, by] of Object.entries(step.changes ?? {})) expected.set(table, (expected.get(table) ?? 0) + by)
    }

    // 3. check; on any doubt the backup goes back, and the book is as it was found
    const restore = (why: string): never => {
      db.close()
      for (const beside of ["-wal", "-shm", "-journal"]) rmSync(path + beside, { force: true })
      copyFileSync(kept, path)
      db = new DatabaseSync(path)
      throw new Error(`migrating ${path} left it unsound (${why}); it was put back from ${kept}`)
    }
    const why = unsound(db, expected)
    if (why) restore(why)
    if (Number(one(db, "PRAGMA user_version")) !== latest) restore(`its version is ${one(db, "PRAGMA user_version")}, not ${latest}`)
    // readers and the writer do not block each other in WAL; kept in the file from here on (data contract §1)
    const journal = one(db, "PRAGMA journal_mode = WAL")
    if (journal !== "wal") restore(`its journal mode is ${journal}, not wal`)

    return { from, to: latest, backup: kept }
  } finally {
    db.close()
  }
}
