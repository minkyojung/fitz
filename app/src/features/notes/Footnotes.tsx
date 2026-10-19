import { useEffect, useState } from "react"
import { IconTrash } from "@tabler/icons-react"

import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import type { Note } from "@/data/api"
import { locateAnchor } from "@/lib/anchor"
import { cn } from "cn"
import { useAnnotations } from "./AnnotationsContext"

/** The paragraph's notes under its translation, as a book's footnotes are under its page: a translator's note to write
 *  (it cannot be emptied, only deleted), an author's note in English to translate (exported in English until it is).
 *  A note picked by its marker in the text is brought into view here. */
export function Footnotes({ segmentId, text, markers }: { segmentId: number; text: string; markers: Map<number, string> }) {
  const ann = useAnnotations()
  const notes = ann?.annotations.notes.filter((n) => n.segmentId === segmentId) ?? []
  if (!notes.length) return null
  return (
    <ul aria-label="Notes of this paragraph" className="mt-2 space-y-1 border-t border-dashed pt-2">
      {/* keyed by what is saved: a change made elsewhere (⌘Z) starts the row afresh */}
      {notes.map((n) => <FootnoteRow key={`${n.id}:${n.bodyTarget}`} note={n} text={text} label={markers.get(n.id)} />)}
    </ul>
  )
}

function FootnoteRow({ note, text, label }: { note: Note; text: string; label?: string }) {
  const ann = useAnnotations()!
  const selected = ann.selected?.kind === "note" && ann.selected.id === note.id
  const [body, setBody] = useState(note.bodyTarget)
  const [el, setEl] = useState<HTMLLIElement | null>(null)
  useEffect(() => { if (selected) el?.scrollIntoView({ block: "nearest" }) }, [selected, el])
  const translator = note.kind === "translator"
  // placed as its marker is: where its words are still found in the translation
  const placed = note.targetAnchor !== null && locateAnchor(text, note.targetAnchor) !== null
  return (
    <li ref={setEl} data-footnote={note.id} onClick={() => ann.select({ kind: "note", id: note.id })}
      className={cn("space-y-0.5 rounded-sm border-l-2 border-transparent py-1 pl-2 text-xs", selected && "border-mark-note bg-muted/60")}>
      <div className="flex items-center gap-2">
        <sup className="border-b-2 border-mark-note bg-mark-note/40 px-0.5 text-[11px] font-medium text-mark-note-ink">{label ?? (translator ? "*" : "–")}</sup>
        <span className="text-muted-foreground">{translator ? "Translator's note" : "Author's note"}</span>
        {placed ? (
          <span className="min-w-0 truncate text-muted-foreground" lang="ko">· “{note.targetAnchor!.exact}”</span>
        ) : (
          <span className="text-muted-foreground" title="Select the words in the translation, then “Place note”">· not placed</span>
        )}
        {translator && (
          <Button size="icon-xs" variant="ghost" className="ml-auto" aria-label="Delete note" onClick={(e) => { e.stopPropagation(); void ann.actions.deleteNote(note.id) }}>
            <IconTrash />
          </Button>
        )}
      </div>
      {!translator && <p className="reading text-[13px] leading-relaxed text-muted-foreground" lang="en">{note.bodySource}</p>}
      <Textarea value={body} lang="ko" aria-label={translator ? "Note body" : "Note translation"} rows={1}
        placeholder={translator ? "Translator's note…" : "Translation of the note… (exported in English until you do)"}
        className="min-h-0 resize-none border-transparent bg-transparent px-1 py-0.5 text-[13px]/relaxed shadow-none hover:border-input md:text-[13px]/relaxed dark:bg-transparent"
        onChange={(e) => setBody(e.target.value)}
        onBlur={() => {
          const next = body.trim()
          if (next === note.bodyTarget) return
          if (translator && !next) { setBody(note.bodyTarget); return } // a translator's note cannot be emptied; delete it instead
          void ann.actions.setNote(note.id, { body: next })
        }} />
    </li>
  )
}
