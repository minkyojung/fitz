import { useState } from "react"
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

/** A chapter's paragraphs: the source on the left, its translation on the right. One translation is edited at a time;
 *  leaving it saves it — one save, one entry in the book's history. */
export function ChapterView({ chapter, changes, onChanged }: {
  chapter: Chapter
  /** Counts the book's changes: a new number loads the paragraphs again. */
  changes: number
  /** Called once this view has changed the book. */
  onChanged: () => void
}) {
  const loaded = useLoad(chapter.id, (signal) => request("listSegments", { chapterId: chapter.id }, signal), changes)
  // The paragraph being edited, where its caret starts, and the version it had when the edit began: a save names that
  // version, so it never overwrites what another writer did meanwhile.
  const [editing, setEditing] = useState<{ id: number; caret: number | "end"; base: number } | null>(null)
  // Translations on their way to the server, shown until the save settles so the old text does not flash back.
  const [saving, setSaving] = useState<Record<number, Doc | null>>({})

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
  const edit = (segment: Segment, caret: number | "end") => setEditing({ id: segment.id, caret, base: segment.version })

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
    if (Object.keys(patch).length === 0) return

    setSaving((s) => ({ ...s, [segment.id]: next }))
    try {
      const saved = await request("updateSegment", { id: segment.id, patch, expectVersion: base })
      setSegments(segments.map((s) => (s.id === saved.id ? saved : s)))
      onChanged()
    } catch (e) {
      toast.error("The translation was not saved", { description: e instanceof Error ? e.message : String(e) })
    } finally {
      setSaving((s) => {
        const rest = { ...s }
        delete rest[segment.id]
        return rest
      })
    }
  }

  return (
    <div className="flex flex-1 flex-col px-4 pb-8">
      {segments.map((segment) => (
        <SegmentRow
          key={segment.id}
          segment={segment}
          target={segment.id in saving ? saving[segment.id]! : segment.targetDoc}
          editing={editing?.id === segment.id ? editing : null}
          onEdit={(caret) => edit(segment, caret)}
          onLeave={(doc, how) => void leave(segment, editing?.base ?? segment.version, doc, how)}
          onCancel={() => setEditing(null)}
        />
      ))}
    </div>
  )
}
