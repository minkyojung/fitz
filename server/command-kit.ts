// What the commands that write to a book share (commands.ts, structure.ts).
import type { DatabaseSync } from "node:sqlite"

import { z } from "zod"

import type { Doc } from "../shared/protocol.ts"
import { RequestError, readSegments } from "./book.ts"

/** What a command did: its result, itself as logged (replayable as it is), its inverse, the paragraphs it touched.
 *  Or, when it found nothing to change, only its result. */
export type Done =
  | { result: unknown; forward: unknown; inverse: { name: string; params: unknown }; segmentIds: number[] }
  | { result: unknown; unchanged: true }
export type Command = (db: DatabaseSync, params: unknown) => Done
export type Row = Record<string, unknown>

/** What was sent, as the command expects it, or a 400 saying what is wrong with it. */
export const sent = <S extends z.ZodType>(schema: S, name: string, params: unknown): z.infer<S> => {
  const parsed = schema.safeParse(params)
  if (!parsed.success) throw new RequestError(400, `${name}: ${z.prettifyError(parsed.error)}`)
  return parsed.data
}

/** The paragraph as the page is given it. */
export const segmentOut = (db: DatabaseSync, id: number) => readSegments(db, "one", id)[0]!

/** The paragraph's row, or a 404. */
export const getSegment = (db: DatabaseSync, id: number): Row => {
  const row = db.prepare("SELECT * FROM segment WHERE id = ?").get(id)
  if (!row) throw new RequestError(404, `paragraph ${id} not found`)
  return row
}

/** The translator and Claude both write: neither changes what the other wrote unseen. */
export const checkVersion = (row: Row, expectVersion: number | undefined) => {
  if (expectVersion !== undefined && expectVersion !== row.version) throw new RequestError(409, `paragraph ${row.id} changed since it was read`)
}

/** Plain text of a document: text nodes joined, paragraphs joined by a newline. */
export const docText = (doc: Doc) => doc.content.map((p) => (p.content ?? []).map((n) => n.text).join("")).join("\n")
export const textDoc = (text: string): Doc => ({ type: "doc", content: [{ type: "paragraph", content: text ? [{ type: "text", text }] : [] }] })
