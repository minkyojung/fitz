// A request from the page, by its name: what was sent is checked against the protocol first, then it goes to the
// reader or — for a change — to the writer, as the translator's.
import { z } from "zod"

import { REQUESTS, isRequestName, type Params, type RequestName, type Result, type Segment } from "../shared/protocol.ts"
import { RequestError, type BookReader } from "./book.ts"
import type { Writer } from "./commands.ts"

export interface Library {
  /** Reads; its connection cannot write. */
  book: BookReader
  /** Every change goes through here. */
  writer: Writer
}

export function answer<N extends RequestName>(library: Library, name: N, params: unknown): Result<N>
export function answer(library: Library, name: string, params: unknown): unknown
export function answer({ book, writer }: Library, name: string, params: unknown): unknown {
  if (!isRequestName(name)) throw new RequestError(404, `unknown request ${name}`)
  const parsed = REQUESTS[name].params.safeParse(params)
  if (!parsed.success) throw new RequestError(400, `${name}: ${z.prettifyError(parsed.error)}`)
  const sent = <N extends RequestName>(_: N) => parsed.data as Params<N>
  switch (name) {
    case "getBook":
      return book.getBook()
    case "listChapters":
      return book.listChapters()
    case "listSegments":
      return book.listSegments(sent(name).chapterId)
    case "listPages":
      return book.listPages()
    case "updateSegment": {
      const { id, patch, expectVersion } = sent(name)
      const saved = writer.execute("updateSegment", { id, text: patch.sourceText, doc: patch.sourceDoc, kind: patch.kind, verified: patch.verified, targetDoc: patch.targetDoc, status: patch.status, expectVersion }) as Segment
      // the translation the translator saved stands in place of what was being typed
      if (patch.targetDoc === undefined) return saved
      writer.dropDraft(id)
      return { ...saved, draft: null }
    }
    case "saveDraft": {
      const { segmentId, doc, baseVersion } = sent(name)
      writer.saveDraft(segmentId, doc, baseVersion)
      return null
    }
    case "dropDraft":
      writer.dropDraft(sent(name).segmentId)
      return null
    case "undo":
      return writer.undo()
    case "redo":
      return writer.redo()
    default: {
      // every request in the protocol is answered here: a new one that is not fails to compile
      const unanswered: never = name
      throw new RequestError(404, `unknown request ${String(unanswered)}`)
    }
  }
}
