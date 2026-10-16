import { useCallback, useEffect, useRef, useState } from "react"

import { ScrollArea } from "@/components/ui/scroll-area"
import { PairRow } from "./PairRow"
import type { DocJSON, Segment, SegmentPatch } from "@/data/api"

interface Props {
  segments: Segment[]
  onPatch: (id: number, patch: SegmentPatch) => Promise<unknown>
  focusMode: boolean
}

const unconfirmed = (s: Segment) => s.status === "untranslated" || s.status === "draft"

/** Bilingual-book view: facing paragraphs, one translation editor at a time, caret flowing between pairs. */
export function useTranslate({ segments, onPatch, focusMode }: Props) {
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [caretEdge, setCaretEdge] = useState<"start" | "end">("end")
  const shownChapter = useRef<number | null>(null)

  useEffect(() => {
    const first = segments[0]
    if (!first) return
    if (first.chapterId === shownChapter.current) {
      if (selectedId !== null && !segments.some((s) => s.id === selectedId)) setSelectedId(null)
      return
    }
    shownChapter.current = first.chapterId
    // land on the first unconfirmed pair of a chapter
    setSelectedId((segments.find(unconfirmed) ?? first).id)
    setEditingId(null)
  }, [segments, selectedId])

  const selected = segments.find((s) => s.id === selectedId) ?? null
  const indexOf = (id: number | null) => segments.findIndex((s) => s.id === id)

  const selectByDelta = useCallback(
    (delta: number) => {
      const i = indexOf(selectedId)
      const next = segments[Math.min(segments.length - 1, Math.max(0, (i === -1 ? 0 : i) + delta))]
      if (next) setSelectedId(next.id)
    },
    [segments, selectedId], // eslint-disable-line react-hooks/exhaustive-deps
  )
  /** Keyboard flow from inside the editor: continue editing the neighbour, caret at the near edge. */
  const flow = useCallback(
    (from: number, delta: 1 | -1) => {
      const next = segments[indexOf(from) + delta]
      if (!next) return
      setCaretEdge(delta === 1 ? "start" : "end")
      setSelectedId(next.id)
      setEditingId(next.id)
    },
    [segments], // eslint-disable-line react-hooks/exhaustive-deps
  )
  const step = useCallback((from: number, delta: 1 | -1) => { setCaretEdge("end"); flow(from, delta) }, [flow])
  /** ⌘Enter: save as reviewed, then open the next unconfirmed pair. */
  const confirm = useCallback(
    async (id: number, doc: DocJSON) => {
      const hasText = doc.content.some((p) => (p.content ?? []).some((n) => n.text.trim()))
      await onPatch(id, hasText ? { targetDoc: doc, status: "reviewed" } : { targetDoc: null })
      const i = indexOf(id)
      const next = segments.slice(i + 1).find(unconfirmed)
      if (!next) { setEditingId(null); return }
      setCaretEdge("end")
      setSelectedId(next.id)
      setEditingId(next.id)
    },
    [onPatch, segments], // eslint-disable-line react-hooks/exhaustive-deps
  )

  const commands = {
    selectNext: () => selectByDelta(1),
    selectPrev: () => selectByDelta(-1),
    startEdit: () => { if (selected) { setCaretEdge("end"); setEditingId(selected.id) } },
    cancelEdit: () => setEditingId(null),
    toggleVerified: () => undefined, // Space has no meaning here
  }

  const view = (
    <ScrollArea className="h-full">
      <div className="grid grid-cols-[1rem_1fr_1fr] gap-x-6 px-4 py-3">
        {segments.map((s) => (
          <PairRow
            key={s.id}
            segment={s}
            selected={s.id === selectedId}
            editing={s.id === editingId}
            caretEdge={caretEdge}
            dim={focusMode && editingId !== null && editingId !== s.id}
            onSelect={() => setSelectedId(s.id)}
            onEditingChange={(on) => setEditingId(on ? s.id : null)}
            onPatch={(patch) => onPatch(s.id, patch)}
            onConfirm={(doc) => void confirm(s.id, doc)}
            onStep={(d) => step(s.id, d)}
            onFlow={(d) => flow(s.id, d)}
          />
        ))}
      </div>
    </ScrollArea>
  )
  return { view, selected, editing: editingId !== null, commands }
}
