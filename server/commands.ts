// Writing to a book. Every write is one command, run in a transaction and logged to `ops` with its inverse, so it
// can be taken back and done again — by whoever made it, and never over a later change to the same thing.
// The rules and the log's shape are the prototype's (docs/data-contract.md §3, §5); what is new here is the floor:
// changes logged before this app (ops.id ≤ meta.undo_floor) are history only.
import { existsSync } from "node:fs"
import { DatabaseSync } from "node:sqlite"
import { isDeepStrictEqual } from "node:util"

import { z } from "zod"

import { Doc, SEGMENT_KINDS, SEGMENT_STATUSES, type Change, type Side } from "../shared/protocol.ts"
import { RequestError, readSegments } from "./book.ts"
import { LATEST } from "./migrate.ts"

/** Who made a change: known by the door it came in through — the page's requests are the translator's, Claude's tools the agent's. */
export interface By {
  actor: "translator" | "agent"
  /** Claude's change carries the id of the tool call that made it. */
  toolUseId?: string
}
export const TRANSLATOR: By = Object.freeze({ actor: "translator" })

/** What a command did: its result, itself as logged (replayable as it is), its inverse, the paragraphs it touched.
 *  Or, when it found nothing to change, only its result. */
type Done =
  | { result: unknown; forward: unknown; inverse: { name: string; params: unknown }; segmentIds: number[] }
  | { result: unknown; unchanged: true }
type Command = (db: DatabaseSync, params: unknown) => Done

type Row = Record<string, unknown>
/** The paragraph as the page is given it. */
const segmentOut = (db: DatabaseSync, id: number) => readSegments(db, "one", id)[0]!

/** What was sent, as the command expects it, or a 400 saying what is wrong with it. */
const sent = <S extends z.ZodType>(schema: S, name: string, params: unknown): z.infer<S> => {
  const parsed = schema.safeParse(params)
  if (!parsed.success) throw new RequestError(400, `${name}: ${z.prettifyError(parsed.error)}`)
  return parsed.data
}

/** Plain text of a document: text nodes joined, paragraphs joined by a newline. */
const docText = (doc: Doc) => doc.content.map((p) => (p.content ?? []).map((n) => n.text).join("")).join("\n")
const textDoc = (text: string): Doc => ({ type: "doc", content: [{ type: "paragraph", content: text ? [{ type: "text", text }] : [] }] })

const UpdateSegment = z.strictObject({
  id: z.int(),
  /** The source as plain text; `doc` wins when both are sent. */
  text: z.string().optional(),
  doc: Doc.optional(),
  kind: z.enum(SEGMENT_KINDS).optional(),
  verified: z.boolean().optional(),
  /** null takes the translation away. */
  targetDoc: Doc.nullable().optional(),
  status: z.enum(SEGMENT_STATUSES).optional(),
  /** The version the writer last saw. Not part of the logged command: redo must not depend on it. */
  expectVersion: z.int().optional(),
})

const COMMANDS: Record<string, Command> = {
  updateSegment(db, params) {
    const p = sent(UpdateSegment, "updateSegment", params)
    const cur = db.prepare("SELECT * FROM segment WHERE id = ?").get(p.id)
    if (!cur) throw new RequestError(404, `paragraph ${p.id} not found`)
    // the translator and Claude both write: neither overwrites what the other wrote unseen
    if (p.expectVersion !== undefined && p.expectVersion !== cur.version) throw new RequestError(409, `paragraph ${p.id} changed since it was read`)
    if (p.doc && p.doc.content.length !== 1) throw new RequestError(400, "updateSegment: the source must be a single paragraph")

    const curDoc = JSON.parse(String(cur.source_doc)) as Doc
    const curTarget = cur.target_doc === null ? null : (JSON.parse(String(cur.target_doc)) as Doc)
    // what is sent the same as what is there is kept as it is stored: the same text keeps its marks
    const nextDoc = p.doc !== undefined ? (isDeepStrictEqual(p.doc, curDoc) ? curDoc : p.doc) : p.text !== undefined && p.text !== cur.source_text ? textDoc(p.text) : curDoc
    const nextTarget = p.targetDoc === undefined || isDeepStrictEqual(p.targetDoc, curTarget) ? curTarget : p.targetDoc
    const nextTargetText = nextTarget ? docText(nextTarget) : null
    let nextStatus = p.status ?? String(cur.status)
    if (p.targetDoc !== undefined && p.status === undefined) {
      // a first translation moves untranslated → draft; clearing it moves back
      if (nextTargetText?.trim() && cur.status === "untranslated") nextStatus = "draft"
      if (!nextTargetText?.trim()) nextStatus = "untranslated"
    }
    const nextKind = p.kind ?? String(cur.kind)
    const nextVerified = p.verified ?? cur.verified === 1

    const unchanged = nextDoc === curDoc && nextTarget === curTarget && nextStatus === cur.status && nextKind === cur.kind && nextVerified === (cur.verified === 1)
    if (unchanged) return { result: segmentOut(db, p.id), unchanged: true }

    // the translation that is replaced is kept
    if (curTarget && nextTarget !== curTarget) db.prepare("INSERT INTO segment_version(segment_id, target_doc) VALUES (?, ?)").run(p.id, String(cur.target_doc))
    // one UPDATE: the trigger gives the paragraph its new version (data contract §3)
    db.prepare(
      `UPDATE segment SET source_text = ?, source_doc = ?, kind = ?, verified = ?, target_doc = ?, target_text = ?, status = ?,
                          updated_at = datetime('now') WHERE id = ?`,
    ).run(
      docText(nextDoc), nextDoc === curDoc ? String(cur.source_doc) : JSON.stringify(nextDoc), nextKind, nextVerified ? 1 : 0,
      nextTarget === curTarget ? (cur.target_doc as string | null) : JSON.stringify(nextTarget), nextTargetText, nextStatus, p.id,
    )
    return {
      result: segmentOut(db, p.id),
      forward: { id: p.id, doc: nextDoc, text: docText(nextDoc), kind: nextKind, verified: nextVerified, targetDoc: nextTarget, status: nextStatus },
      inverse: {
        name: "updateSegment",
        params: { id: p.id, doc: curDoc, text: cur.source_text, kind: cur.kind, verified: cur.verified === 1, targetDoc: curTarget, status: cur.status },
      },
      segmentIds: [p.id],
    }
  },
}

/** What a logged change touched, as keys two changes can share. A later change to the same key stands in the way of undo. */
function touches(row: Row): string[] {
  const segmentIds = JSON.parse(String(row.segment_ids)) as number[]
  switch (row.name) {
    case "updateSegment":
      return segmentIds.map((id) => `seg:${id}`)
    default:
      // never guessed: a command added here says what it touches
      throw new Error(`what ${String(row.name)} touches is not known`)
  }
}

const summary = (row: Row): Change => ({
  id: Number(row.id),
  name: String(row.name),
  segmentIds: JSON.parse(String(row.segment_ids)) as number[],
  actor: row.actor === "agent" ? "agent" : "translator",
})

export type Writer = ReturnType<typeof openWriter>

/** The book opened for writing. Only a book at this app's version, in WAL, with its undo floor (migrate.ts makes it so). */
export function openWriter(path: string) {
  if (!existsSync(path)) throw new Error(`no book database at ${path}`)
  const db = new DatabaseSync(path)
  let revision = 0
  try {
    db.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000")
    const version = Number(Object.values(db.prepare("PRAGMA user_version").get() ?? {})[0])
    if (version !== LATEST) throw new Error(`${path} is at book version ${version}, and this app writes version ${LATEST}`)
    const journal = Object.values(db.prepare("PRAGMA journal_mode = WAL").get() ?? {})[0]
    if (journal !== "wal") throw new Error(`${path} could not be put in WAL mode (it is ${journal})`)
    const floorRow = db.prepare("SELECT value FROM meta WHERE key = 'undo_floor'").get()
    const floor = Number(floorRow?.value)
    if (!floorRow || !Number.isInteger(floor) || floor < 0) throw new Error(`${path} has no undo floor`)

    const inTransaction = <T>(fn: () => T): T => {
      db.exec("BEGIN IMMEDIATE")
      try {
        const out = fn()
        db.exec("COMMIT")
        return out
      } catch (e) {
        db.exec("ROLLBACK")
        throw e
      }
    }
    const run = (name: string, params: unknown): Done => {
      const command = Object.hasOwn(COMMANDS, name) ? COMMANDS[name] : undefined
      if (!command) throw new RequestError(404, `unknown command ${name}`)
      return command(db, params)
    }
    const touch = () => db.prepare("INSERT OR REPLACE INTO meta(key, value) VALUES ('last_edit_at', datetime('now'))").run()

    /** Refuse (409, saying who changed what) if a change logged after `row`, still standing, touched something `row` touched. */
    const refuseOverLater = (row: Row) => {
      const mine = new Set(touches(row))
      for (const later of db.prepare("SELECT * FROM ops WHERE id > ? AND undone = 0 ORDER BY id").all(Number(row.id))) {
        const key = touches(later).find((k) => mine.has(k))
        if (!key) continue
        const what = key.startsWith("seg:") ? `¶${key.slice(4)}` : `the ${key.slice(0, key.indexOf(":"))}`
        throw new RequestError(409, `${later.actor === "agent" ? "Claude" : "You"} changed ${what} after this`)
      }
    }
    /** Undo (`to` 1) or redo (`to` 0) `by`'s change: the last standing, or the one taken back last. Never one at or below the floor. */
    const step = (by: By, to: 0 | 1): Change | null => {
      const change = inTransaction(() => {
        const row = db.prepare(`SELECT * FROM ops WHERE undone = ? AND actor = ? AND id > ? ORDER BY id ${to === 1 ? "DESC" : "ASC"} LIMIT 1`).get(1 - to, by.actor, floor)
        if (!row) return null
        refuseOverLater(row)
        if (to === 1) run(String(row.inverse_name), JSON.parse(String(row.inverse_params)))
        else run(String(row.name), JSON.parse(String(row.params)))
        db.prepare("UPDATE ops SET undone = ? WHERE id = ?").run(to, Number(row.id))
        touch()
        return summary(row)
      })
      if (change) revision++
      return change
    }

    return {
      /** Run a command as a new change by `by`: log it, end that writer's redo, mark the book edited. Returns the command's result. */
      execute(name: string, params: unknown, by: By = TRANSLATOR): unknown {
        if (by.actor !== "translator" && by.actor !== "agent") throw new Error(`a change is the translator's or the agent's, not ${String(by.actor)}`)
        let changed = false
        const result = inTransaction(() => {
          const done = run(name, params)
          if ("unchanged" in done) return done.result
          // a new change ends only its own writer's redo — and never removes a row from before this app
          db.prepare("DELETE FROM ops WHERE undone = 1 AND actor = ? AND id > ?").run(by.actor, floor)
          db.prepare("INSERT INTO ops(name, params, inverse_name, inverse_params, segment_ids, actor, tool_use_id) VALUES (?, ?, ?, ?, ?, ?, ?)")
            .run(name, JSON.stringify(done.forward), done.inverse.name, JSON.stringify(done.inverse.params), JSON.stringify(done.segmentIds), by.actor, by.toolUseId ?? null)
          touch()
          changed = true
          return done.result
        })
        if (changed) revision++
        return result
      },
      /** Take back `by`'s last change still standing. null when there is none. */
      undo: (by: By = TRANSLATOR): Change | null => step(by, 1),
      /** Do again `by`'s change taken back last. null when there is none. */
      redo: (by: By = TRANSLATOR): Change | null => step(by, 0),
      /** Keep what is being typed into one side of a paragraph (one draft per paragraph and side, the latest). Not a
       *  change to the book: nothing is logged, no version moves. */
      saveDraft(segmentId: number, side: Side, doc: Doc, baseVersion: number): void {
        if (!db.prepare("SELECT 1 FROM segment WHERE id = ?").get(segmentId)) throw new RequestError(404, `paragraph ${segmentId} not found`)
        db.prepare("INSERT OR REPLACE INTO draft(segment_id, side, doc, base_version, saved_at) VALUES (?, ?, ?, ?, datetime('now'))").run(segmentId, side, JSON.stringify(doc), baseVersion)
      },
      dropDraft(segmentId: number, side: Side): void {
        db.prepare("DELETE FROM draft WHERE segment_id = ? AND side = ?").run(segmentId, side)
      },
      /** How many changes this writer has made since it was opened: do, undo and redo each count. */
      revision: (): number => revision,
      close(): void {
        db.close()
      },
    }
  } catch (e) {
    db.close()
    throw e
  }
}
