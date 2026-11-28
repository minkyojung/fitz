import { useRef, useState } from "react"
import { toast } from "sonner"

import type { Doc, Segment, SegmentPatch, Side } from "@shared/protocol.ts"

import type { Leave } from "@/components/segment-editor"
import { request } from "@/data/api"

const docText = (doc: Doc) => doc.content.map((p) => (p.content ?? []).map((n) => n.text).join("")).join("\n")
const sameDoc = (a: Doc | null, b: Doc | null) => JSON.stringify(a) === JSON.stringify(b)
const docOf = (segment: Segment, side: Side) => (side === "source" ? segment.sourceDoc : segment.targetDoc)
const WHAT: Record<Side, string> = { source: "The paragraph", target: "The translation" }

/** What a row needs to show one side of a paragraph and to edit it. */
export interface SideEdit {
  /** The text to show: the one being saved until the save settles, else the paragraph's own. */
  shown: Doc | null
  /** Text typed here and never saved, when there is some. */
  draft: { changedSince: boolean } | null
  /** Set while this side is being edited: where the caret starts and the text the edit opens on. */
  editing: { caret: number | "end" | "all"; doc: Doc | null } | null
  onEdit: (caret: number | "end" | "all") => void
  onLeave: (doc: Doc, how: Leave, caret: number) => void
  onCancel: () => void
  onDraft: (doc: Doc) => void
  onDiscard: () => void
}

/** Editing one side of a chapter's paragraphs, one paragraph at a time. Leaving an edit saves it — one save, one entry
 *  in the book's history — naming the version the paragraph had when the edit began, so it never overwrites what
 *  another writer did meanwhile. What is typed is kept by the server as a draft until then: a crash or a refused save
 *  loses nothing. */
export function useSegmentEdits({ side, segments, setSegments, onChanged, onEditing }: {
  side: Side
  segments: Segment[]
  /** Put in a paragraph the server has just answered with. */
  setSegments: (segments: Segment[]) => void
  /** Called once this has changed what the server holds. */
  onChanged: () => void
  /** Called when an edit begins on a paragraph. */
  onEditing?: (segment: Segment) => void
}) {
  const [editing, setEditing] = useState<{ id: number; caret: number | "end" | "all"; doc: Doc | null; base: number } | null>(null)
  // texts on their way to the server, shown until the save settles so the old text does not flash back
  const [saving, setSaving] = useState<Record<number, Doc | null>>({})
  // Drafts go to the server one after another, and a save waits for them: a draft must never land after the save that
  // replaces it. `drafted` names the paragraphs a draft was written for here.
  const draftQueue = useRef<Promise<unknown>>(Promise.resolve())
  const drafted = useRef(new Set<number>())

  /** The draft kept for a paragraph, unless it says nothing the paragraph does not already say. */
  const draftOf = (segment: Segment) => {
    const draft = segment.drafts[side]
    return draft && !sameDoc(draft.doc, docOf(segment, side)) ? draft : null
  }
  // an edit opens on the draft when there is one: text typed and never saved is not passed over
  const edit = (segment: Segment, caret: number | "end" | "all") => {
    const draft = draftOf(segment)
    setEditing({ id: segment.id, caret: draft ? "end" : caret, doc: draft?.doc ?? docOf(segment, side), base: segment.version })
    onEditing?.(segment)
  }
  const keepDraft = (segmentId: number, doc: Doc, base: number) => {
    drafted.current.add(segmentId)
    draftQueue.current = draftQueue.current.then(() => request("saveDraft", { segmentId, side, doc, baseVersion: base })).catch(() => {})
  }
  /** Once the drafts on their way have landed, drop the one for this paragraph, if one was written here or was there. */
  async function dropDraft(segment: Segment) {
    await draftQueue.current
    if (!drafted.current.delete(segment.id) && !segment.drafts[side]) return
    await request("dropDraft", { segmentId: segment.id, side }).catch(() => {})
    onChanged()
  }

  async function leave(segment: Segment, base: number, doc: Doc, how: Leave, caret: number) {
    // Tab, Shift-Tab and ⌘Enter in a translation go on to a neighbour; anything else ends editing
    const at = segments.findIndex((s) => s.id === segment.id)
    const onward = how === "next" || how === "previous" || how === "confirm"
    const neighbour = onward ? segments[at + (how === "previous" ? -1 : 1)] : undefined
    if (neighbour) edit(neighbour, "end")
    else setEditing(null)

    const patch: SegmentPatch = {}
    let next: Doc | null = doc
    if (side === "target") {
      // a translation of nothing but blanks is no translation
      next = docText(doc).trim() ? doc : null
      if (!sameDoc(next, segment.targetDoc)) patch.targetDoc = next
      if (how === "confirm" && next && segment.status !== "reviewed") patch.status = "reviewed"
    } else if (!sameDoc(doc, segment.sourceDoc)) {
      patch.sourceDoc = doc
    }
    const changesText = patch.targetDoc !== undefined || patch.sourceDoc !== undefined
    // nothing of the text to save: what was typed along the way, or left from before, goes
    if (!changesText) void dropDraft(segment)
    if (Object.keys(patch).length === 0) {
      if (how === "split") await split(segment, caret, base)
      return
    }

    setSaving((s) => ({ ...s, [segment.id]: next }))
    try {
      await draftQueue.current
      const saved = await request("updateSegment", { id: segment.id, patch, expectVersion: base })
      // the server dropped the draft with the save
      if (changesText) drafted.current.delete(segment.id)
      setSegments(segments.map((s) => (s.id === saved.id ? saved : s)))
      // a cut falls in the text as it was saved, so the save comes first: if it is refused, nothing is cut
      if (how === "split") await split(saved, caret, saved.version)
    } catch (e) {
      // not saved — the paragraph changed meanwhile, or the server would not: what was typed stays as a draft
      await request("saveDraft", { segmentId: segment.id, side, doc, baseVersion: base }).catch(() => {})
      toast.error(`${WHAT[side]} was not saved`, { description: `${e instanceof Error ? e.message : String(e)}. What you typed is kept as a draft.` })
    } finally {
      setSaving((s) => {
        const rest = { ...s }
        delete rest[segment.id]
        return rest
      })
      onChanged()
    }
  }

  /** Cut the paragraph at a text offset of its source. */
  async function split(segment: Segment, offset: number, version: number) {
    try {
      await request("splitSegment", { id: segment.id, offset, expectVersion: version })
    } catch (e) {
      toast.error("The paragraph was not split", { description: e instanceof Error ? e.message : String(e) })
    } finally {
      onChanged()
    }
  }

  return {
    /** The paragraph being edited, if one is. */
    editingId: editing?.id ?? null,
    edit,
    /** Everything a row needs for this side of `segment`. */
    sideOf(segment: Segment): SideEdit {
      const draft = draftOf(segment)
      const base = editing?.id === segment.id ? editing.base : segment.version
      return {
        shown: segment.id in saving ? saving[segment.id]! : docOf(segment, side),
        draft: draft && !(segment.id in saving) ? { changedSince: draft.baseVersion !== segment.version } : null,
        editing: editing?.id === segment.id ? editing : null,
        onEdit: (caret) => edit(segment, caret),
        onLeave: (doc, how, caret) => void leave(segment, base, doc, how, caret),
        onCancel: () => {
          setEditing(null)
          void dropDraft(segment)
        },
        onDraft: (doc) => keepDraft(segment.id, doc, base),
        onDiscard: () => void dropDraft(segment),
      }
    },
  }
}
