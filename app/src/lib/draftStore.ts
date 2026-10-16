/** Unsaved-edit drafts in localStorage. Crash insurance only: never part of history or undo.
 *  Key: draft:<bookId>:<segmentId>. Cleared when the segment is saved or the edit is cancelled. */

import type { DocJSON } from "@/data/api"

export interface Draft {
  doc: DocJSON
  /** Text the draft was based on; if the server text differs now, the draft is stale. */
  baseText: string
  savedAt: number
}

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">

export type Side = "source" | "target"
const key = (bookId: number, segmentId: number, side: Side) => `draft:${bookId}:${segmentId}${side === "target" ? ":target" : ""}`

export function createDraftStore(store: Store, bookId: number) {
  return {
    save(segmentId: number, doc: DocJSON, baseText: string, side: Side = "source") {
      const d: Draft = { doc, baseText, savedAt: Date.now() }
      store.setItem(key(bookId, segmentId, side), JSON.stringify(d))
    },
    load(segmentId: number, side: Side = "source"): Draft | null {
      const raw = store.getItem(key(bookId, segmentId, side))
      if (!raw) return null
      try {
        return JSON.parse(raw) as Draft
      } catch {
        store.removeItem(key(bookId, segmentId, side))
        return null
      }
    },
    clear(segmentId: number, side: Side = "source") {
      store.removeItem(key(bookId, segmentId, side))
    },
    /** Segment ids that have a draft, for the badge pass after a chapter loads. */
    ids(): number[] {
      const prefix = `draft:${bookId}:`
      const out: number[] = []
      for (let i = 0; i < store.length; i++) {
        const k = store.key(i)
        if (k?.startsWith(prefix)) out.push(Number(k.slice(prefix.length)))
      }
      return out
    },
  }
}

export type DraftStore = ReturnType<typeof createDraftStore>
