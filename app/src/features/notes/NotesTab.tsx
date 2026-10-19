import { useEffect, useState } from "react"
import { IconTrash } from "@tabler/icons-react"

import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Textarea } from "@/components/ui/textarea"
import type { Note, Segment } from "@/data/api"
import { cn } from "cn"
import { useAnnotations } from "./AnnotationsContext"

interface Props {
  segment: Segment | null
  segments: Segment[]
  markers: Map<number, string>
}

/** The notes of the selected paragraph: translator's notes editable, author's notes shown and translated. Its comments
 *  open from their marks; the chapter's, and the author notes not placed, from the status bar's Notes. */
export function NotesTab({ segment: panelSegment, segments, markers }: Props) {
  const ann = useAnnotations()
  if (!ann) return null
  // a selected note (clicked in the text) wins over the row selection
  const sel = ann.selected
  const selSegmentId = sel?.kind === "note" ? ann.annotations.notes.find((n) => n.id === sel.id)?.segmentId : undefined
  const segment = (selSegmentId !== undefined ? segments.find((s) => s.id === selSegmentId) : undefined) ?? panelSegment
  const notes = segment ? ann.annotations.notes.filter((n) => n.segmentId === segment.id) : []

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-8 shrink-0 items-center gap-2 border-b px-3 text-xs">
        <span className="font-medium">Notes</span>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        {!segment ? (
          <p className="p-3 text-xs text-muted-foreground">Select a paragraph.</p>
        ) : notes.length === 0 ? (
          <p className="p-3 text-xs text-muted-foreground">Nothing here yet. Select text and choose Translator's note.</p>
        ) : (
          <ul className="divide-y text-xs" aria-label="Notes of this paragraph">
            {notes.map((n) => <NoteItem key={n.id} note={n} label={markers.get(n.id)} />)}
          </ul>
        )}
      </ScrollArea>
    </div>
  )
}

function NoteItem({ note, label }: { note: Note; label?: string }) {
  const ann = useAnnotations()!
  const selected = ann.selected?.kind === "note" && ann.selected.id === note.id
  const [body, setBody] = useState(note.bodyTarget)
  useEffect(() => setBody(note.bodyTarget), [note.bodyTarget])
  const ref = useScrollWhen(selected)
  const translator = note.kind === "translator"
  return (
    <li ref={ref} data-panel-note={note.id} onClick={() => ann.select({ kind: "note", id: note.id })}
      className={cn("space-y-1 border-l-2 border-transparent px-3 py-2", selected && "border-mark-note bg-muted")}>
      <div className="flex items-center gap-2">
        <sup className="border-b-2 border-mark-note bg-mark-note/40 px-0.5 text-[11px] font-medium text-mark-note-ink">{label ?? (translator ? "*" : "–")}</sup>
        <span className="text-muted-foreground">{translator ? "Translator's note" : "Author's note"}</span>
        {note.targetAnchor ? (
          <span className="ml-auto truncate text-muted-foreground" lang="ko">“{note.targetAnchor.exact}”</span>
        ) : (
          <span className="ml-auto text-muted-foreground" title="Select the words in the translation, then “Place note”">not placed</span>
        )}
        {translator && (
          <Button size="icon-xs" variant="ghost" aria-label="Delete note" onClick={(e) => { e.stopPropagation(); void ann.actions.deleteNote(note.id) }}>
            <IconTrash />
          </Button>
        )}
      </div>
      {!translator && <p className="reading text-[13px] leading-normal text-muted-foreground" lang="en">{note.bodySource}</p>}
      <Textarea value={body} lang="ko" aria-label={translator ? "Note body" : "Note translation"} rows={2} className="min-h-8 text-xs"
        placeholder={translator ? "Translator's note…" : "Translation of the note… (exported in English until you do)"}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => setBody(e.target.value)}
        onBlur={() => {
          const next = body.trim()
          if (next === note.bodyTarget) return
          if (translator && !next) return // a translator's note cannot be emptied; delete it instead
          void ann.actions.setNote(note.id, { body: next })
        }} />
    </li>
  )
}

function useScrollWhen(on: boolean) {
  const [el, setEl] = useState<HTMLLIElement | null>(null)
  useEffect(() => { if (on) el?.scrollIntoView({ block: "nearest" }) }, [on, el])
  return setEl
}
