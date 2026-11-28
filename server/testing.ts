// For tests only: throwaway copies of the development copy of the book (scripts/dev-data.sh). Tests never change
// the copy in dev-data/ itself — running the app does (it migrates the book it opens), so a test cannot assume
// which version that copy is at and makes its own.
import { existsSync, mkdirSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { DatabaseSync, backup } from "node:sqlite"

import { migrate } from "./migrate.ts"

const ROOT = resolve(import.meta.dirname, "..")
export const COPY = process.env.FITZ_DB ?? join(ROOT, "dev-data/out/book.db")

/** A copy of the book in `dir` (made if missing): as the prototype left it (version 0), or migrated to this app's version. */
export async function bookCopy(dir: string, as: "prototype" | "migrated"): Promise<{ path: string; backupDir: string }> {
  if (!existsSync(COPY)) throw new Error(`no development copy at ${COPY} — make it with: scripts/dev-data.sh`)
  mkdirSync(dir, { recursive: true })
  const path = join(dir, "book.db")
  const backupDir = join(dir, "backups")
  const source = new DatabaseSync(COPY, { readOnly: true })
  try {
    await backup(source, path)
  } finally {
    source.close()
  }
  // whatever version the development copy is at, start from the prototype's
  const db = new DatabaseSync(path)
  db.exec("DROP TABLE IF EXISTS draft; DELETE FROM meta WHERE key = 'undo_floor'; PRAGMA journal_mode = DELETE; PRAGMA user_version = 0")
  db.close()
  if (as === "migrated") await migrate(path, { backupDir })
  return { path, backupDir }
}

/** A new book at `path`: the prototype's schema (db/schema.sql) with one book in it and whatever `fill` adds, then
 *  migrated to this app's version — the way any book gets there. */
export async function newBook(path: string, fill?: (db: DatabaseSync) => void): Promise<string> {
  const db = new DatabaseSync(path)
  db.exec(readFileSync(join(ROOT, "db/schema.sql"), "utf8"))
  db.exec("INSERT INTO book(id, title, source_pdf) VALUES (1, 'A Book', '/nowhere.pdf')")
  fill?.(db)
  db.close()
  await migrate(path, { backupDir: `${path}.backups` })
  return path
}
