import { useRef, useState } from "react"
import { toast } from "sonner"

import type { Chapter, Doc, Segment, SegmentPatch } from "@shared/protocol.ts"

import { LoadError } from "@/components/load-error"
import type { Leave } from "@/components/segment-editor"
import { SegmentRow } from "@/components/segment-row"
import { Skeleton } from "@/components/ui/skeleton"
import { request } from "@/data/api"
import { useLoad } from "@/hooks/use-load"

const docText = (doc: Doc) => doc.content.map((p) => (p.content ?? []).map((n) => n.text).join("")).join("\n")
const sameDoc = (a: Doc | null, b: Doc | null) => JSON.stringify(a) === JSON.stringify(b)
/** The draft kept for a paragraph, unless it says nothing the paragraph does not already say. */
const draftOf = (segment: Segment) => (segment.draft && !sameDoc(segment.draft.doc, segment.targetDoc) ? segment.draft : null)

/** A chapter's paragraphs: the source on the left, its translation on the right. One translation is edited at a time;
 *  leaving it saves it — one save, one entry in the book's history. What is typed is kept by the server as a draft
 *  until then, so a crash or a refused save loses nothing. */
export function ChapterView({ chapter, changes, onChanged }: {
  chapter: Chapter
  /** Counts the book's changes: a new number loads the paragraphs again. */
  changes: number
  /** Called once this view has changed what the server holds. */
  onChanged: () => void
}) {
  const loaded = useLoad(chapter.id, (signal) => request("listSegments", { chapterId: chapter.id }, signal), changes)
  // The paragraph being edited, where its caret starts, the text the edit opened on, and the version the paragraph had
  // then: a save names that version, so it never overwrites what another writer did meanwhile.
  const [editing, setEditing] = useState<{ id: number; caret: number | "end"; doc: Doc | null; base: number } | null>(null)
  // Translations on their way to the server, shown until the save settles so the old text does not flash back.
  const [saving, setSaving] = useState<Record<number, Doc | null>>({})
  // Drafts go to the server one after another, and a save waits for them: a draft must never land after the save
  // that replaces it. `drafted` names the paragraphs this view has written a draft for.
  const draftQueue = useRef<Promise<unknown>>(Promise.resolve())
  const drafted = useRef(new Set<number>())

  if (loaded.status === "loading")
    return (
      <div className="flex flex-col gap-6 p-4 pt-0" aria-busy="true">
        {[0, 1, 2].map((i) => (
          <div key={i} className="grid grid-cols-2 gap-8">
            <Skeleton className="h-20" />
            <Skeleton className="h-20" />
          </div>
        ))}
      </div>
    )
  if (loaded.status === "error")
    return (
      <div className="p-4 pt-0">
        <LoadError what={`${chapter.title} could not be loaded`} error={loaded.error} retry={loaded.retry} />
      </div>
    )

  const { data: segments, set: setSegments } = loaded
  // an edit opens on the draft when there is one: text typed and never saved is not passed over
  const edit = (segment: Segment, caret: number | "end") => {
    const draft = draftOf(segment)
    setEditing({ id: segment.id, caret: draft ? "end" : caret, doc: draft?.doc ?? segment.targetDoc, base: segment.version })
  }
  const keepDraft = (segmentId: number, doc: Doc, base: number) => {
    drafted.current.add(segmentId)
    draftQueue.current = draftQueue.current.then(() => request("saveDraft", { segmentId, doc, baseVersion: base })).catch(() => {})
  }
  /** Once the drafts on their way have landed, drop the one for this paragraph, if this view wrote one or one was there. */
  async function dropDraft(segment: Segment) {
    await draftQueue.current
    if (!drafted.current.delete(segment.id) && !segment.draft) return
    await request("dropDraft", { segmentId: segment.id }).catch(() => {})
    onChanged()
  }

  async function leave(segment: Segment, base: number, doc: Doc, how: Leave) {
    // Tab, Shift-Tab and ⌘Enter go on to a neighbour; anything else ends editing
    const at = segments.findIndex((s) => s.id === segment.id)
    const neighbour = how === "blur" ? undefined : segments[at + (how === "previous" ? -1 : 1)]
    if (neighbour) edit(neighbour, "end")
    else setEditing(null)

    // a translation of nothing but blanks is no translation
    const next = docText(doc).trim() ? doc : null
    const patch: SegmentPatch = {}
    if (!sameDoc(next, segment.targetDoc)) patch.targetDoc = next
    if (how === "confirm" && next && segment.status !== "reviewed") patch.status = "reviewed"
    // nothing of the translation to save: what was typed along the way, or left from before, goes
    if (patch.targetDoc === undefined) void dropDraft(segment)
    if (Object.keys(patch).length === 0) return

    setSaving((s) => ({ ...s, [segment.id]: next }))
    try {
      await draftQueue.current
      const saved = await request("updateSegment", { id: segment.id, patch, expectVersion: base })
      // the server dropped the draft with the save
      if (patch.targetDoc !== undefined) drafted.current.delete(segment.id)
      setSegments(segments.map((s) => (s.id === saved.id ? saved : s)))
    } catch (e) {
      // not saved — the paragraph changed meanwhile, or the server could not: what was typed stays as a draft
      await request("saveDraft", { segmentId: segment.id, doc, baseVersion: base }).catch(() => {})
      toast.error("The translation was not saved", { description: `${e instanceof Error ? e.message : String(e)}. What you typed is kept as a draft.` })
    } finally {
      setSaving((s) => {
        const rest = { ...s }
        delete rest[segment.id]
        return rest
      })
      onChanged()
    }
  }

  return (
    <div className="flex flex-1 flex-col px-4 pb-8">
      {segments.map((segment) => {
        const draft = draftOf(segment)
        const base = editing?.id === segment.id ? editing.base : segment.version
        return (
          <SegmentRow
            key={segment.id}
            segment={segment}
            target={segment.id in saving ? saving[segment.id]! : segment.targetDoc}
            draft={draft && !(segment.id in saving) ? { changedSince: draft.baseVersion !== segment.version } : null}
            editing={editing?.id === segment.id ? editing : null}
            onEdit={(caret) => edit(segment, caret)}
            onLeave={(doc, how) => void leave(segment, base, doc, how)}
            onCancel={() => {
              setEditing(null)
              void dropDraft(segment)
            }}
            onDraft={(doc) => keepDraft(segment.id, doc, base)}
            onDiscard={() => void dropDraft(segment)}
          />
        )
      })}
    </div>
  )
}
