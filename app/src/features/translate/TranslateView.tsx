import { useCallback, useMemo, useState } from "react"

import { ScrollArea } from "@/components/ui/scroll-area"
import { PairRow } from "./PairRow"
import type { DocJSON, Note, Segment, SegmentPatch } from "@/data/api"
import { footnoteMarkers } from "@/lib/footnotes"
import { locateAnchor } from "@/lib/anchor"

interface Props {
  segments: Segment[]
  onPatch: (id: number, patch: SegmentPatch) => Promise<unknown>
  focusMode: boolean
  /** The chapter's notes, passed in because this hook runs above the annotations provider. */
  notes: Note[]
  onSelectChapter: (chapterId: number) => void
}

const unconfirmed = (s: Segment) => s.status === "untranslated" || s.status === "draft"

/** Bilingual-book view: facing paragraphs, one translation editor at a time, caret flowing between pairs. */
export function useTranslate({ segments, onPatch, focusMode, notes, onSelectChapter }: Props) {
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [caretEdge, setCaretEdge] = useState<"start" | "end">("end")
  const [shownChapter, setShownChapter] = useState<number | null>(null)
  /** The pair a jump asked for (Find, the glossary), selected once its chapter arrives. */
  const [jumpTarget, setJumpTarget] = useState<number | null>(null)
  const markers = useMemo(() => {
    const idx = new Map(segments.map((sg, i) => [sg.id, i]))
    return footnoteMarkers(notes.filter((n) => idx.has(n.segmentId)).map((n) => {
      const sg = segments[idx.get(n.segmentId)!]
      const at = n.targetAnchor ? locateAnchor(sg.targetText, n.targetAnchor) : null
      return { id: n.id, kind: n.kind, segmentIdx: idx.get(n.segmentId)!, start: at ? at.end : null }
    }))
  }, [notes, segments])

  // A different chapter arrived: land on the pair a jump asked for, else on its first unconfirmed pair. The same
  // chapter again (a reload after a write) keeps the selection, unless its pair is gone. Done while rendering, when what
  // it reads changed (React's adjustment for state that follows a prop), not in an effect after the screen showed the
  // old selection.
  const [seen, setSeen] = useState<{ segments: Segment[]; selectedId: number | null } | null>(null)
  if (seen?.segments !== segments || seen.selectedId !== selectedId) {
    setSeen({ segments, selectedId })
    const first = segments[0]
    if (first && first.chapterId === shownChapter) {
      if (selectedId !== null && !segments.some((s) => s.id === selectedId)) setSelectedId(null)
    } else if (first) {
      setShownChapter(first.chapterId)
      const target = segments.find((s) => s.id === jumpTarget)
      if (target) setJumpTarget(null)
      setSelectedId((target ?? segments.find(unconfirmed) ?? first).id)
      setEditingId(null)
    }
  }

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
  /** ⌘Enter: save as reviewed, then open the next unconfirmed pair. Stays put when nothing was saved. */
  const confirm = useCallback(
    async (id: number, doc: DocJSON, expectVersion: number | undefined) => {
      const hasText = doc.content.some((p) => (p.content ?? []).some((n) => n.text.trim()))
      const saved = await onPatch(id, hasText ? { targetDoc: doc, status: "reviewed", expectVersion } : { targetDoc: null, expectVersion })
      if (!saved) return false
      const i = indexOf(id)
      const next = segments.slice(i + 1).find(unconfirmed)
      if (!next) { setEditingId(null); return true }
      setCaretEdge("end")
      setSelectedId(next.id)
      setEditingId(next.id)
      return true
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
            markers={markers}
            onSelect={() => setSelectedId(s.id)}
            onEditingChange={(on) => setEditingId(on ? s.id : null)}
            onPatch={(patch) => onPatch(s.id, patch)}
            onConfirm={(doc, expectVersion) => confirm(s.id, doc, expectVersion)}
            onStep={(d) => step(s.id, d)}
            onFlow={(d) => flow(s.id, d)}
          />
        ))}
      </div>
    </ScrollArea>
  )
  /** A paragraph from elsewhere (Find, the glossary): selected now if it is in this chapter, else once its chapter arrives. */
  const jumpTo = useCallback(
    (segmentId: number, chapterId: number) => {
      if (segments.some((s) => s.id === segmentId)) { setSelectedId(segmentId); setEditingId(null); return }
      setJumpTarget(segmentId)
      onSelectChapter(chapterId)
    },
    [segments, onSelectChapter],
  )

  return { view, selected, editing: editingId !== null, commands, markers, jumpTo }
}
