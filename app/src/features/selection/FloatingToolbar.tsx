import { useEffect, useMemo, useState } from "react"
import { IconBook2, IconMessage, IconNote, IconPinned } from "@tabler/icons-react"

import { Button } from "@/components/ui/button"
import { Popover, PopoverContent } from "@/components/ui/popover"
import { Textarea } from "@/components/ui/textarea"
import { locateAnchor, makeAnchor } from "@/lib/anchor"
import { useSpell } from "@/features/review/SpellContext"
import { useAnnotations } from "@/features/notes/AnnotationsContext"
import { useSelectionState } from "./SelectionContext"
import { useDomSelection } from "./useDomSelection"

/** One toolbar for every selection, wherever it was made (read-only block or the open editor).
 *  A shadcn Popover anchored to the selection rectangle; the popover handles placement and collisions. */
export function FloatingToolbar({ blockText }: { blockText: (segmentId: number, side: "source" | "target") => string }) {
  const state = useSelectionState()
  const spell = useSpell()
  const ann = useAnnotations()
  const [compose, setCompose] = useState<"comment" | "note" | null>(null)
  const [body, setBody] = useState("")
  useDomSelection(compose !== null)

  const sel = state?.selection ?? null
  useEffect(() => { if (!sel) { setCompose(null); setBody("") } }, [sel])
  // a virtual element: the popover positions itself against the selection rectangle
  const anchor = useMemo(() => (sel ? { getBoundingClientRect: () => DOMRect.fromRect(sel.rect) } : null), [sel])

  if (!sel || !anchor || !spell || !ann) return null
  const known = spell.glossary.some((t) => t.term.toLowerCase() === sel.text.toLowerCase())
  // author's notes of this paragraph still waiting for a place in the translation (never placed, or placed in text since rewritten)
  const unplaced = sel.side === "target"
    ? ann.annotations.notes.filter((n) => n.segmentId === sel.segmentId && n.kind === "author" && (!n.targetAnchor || !locateAnchor(blockText(sel.segmentId, "target"), n.targetAnchor)))
    : []
  const close = () => { setCompose(null); setBody(""); state?.publish(null); if (sel.origin === "dom") window.getSelection()?.removeAllRanges() }
  /** Anchor against the stored text: the editor may hold unsaved edits and DOM offsets are per block,
   *  so find the selected words nearest the reported offset rather than trusting the offset itself. */
  const anchorOf = () => {
    const text = blockText(sel.segmentId, sel.side)
    let best = -1
    for (let i = text.indexOf(sel.text); i !== -1; i = text.indexOf(sel.text, i + 1)) if (best === -1 || Math.abs(i - sel.start) < Math.abs(best - sel.start)) best = i
    return best === -1 ? { exact: sel.text, prefix: "", suffix: "", start: sel.start, end: sel.end } : makeAnchor(text, best, best + sel.text.length)
  }
  const submit = async () => {
    if (!body.trim()) return
    if (compose === "comment") await ann.actions.addComment(sel.segmentId, sel.side, anchorOf(), body.trim())
    else await ann.actions.addNote(sel.segmentId, anchorOf(), body.trim())
    close()
  }

  return (
    <Popover open onOpenChange={(o) => { if (!o && !compose) state?.publish(null) }} modal={false}>
      <PopoverContent
        anchor={anchor}
        side="bottom"
        align="center"
        sideOffset={6}
        data-floating-toolbar
        initialFocus={false}
        finalFocus={false}
        className={compose ? "w-72 gap-1.5 p-2" : "w-auto gap-0 p-0.5"}
        onMouseDown={(e) => { if (!(e.target as HTMLElement).closest("textarea")) e.preventDefault() }} // keep the text selection
      >
        {compose ? (
          <>
            <Textarea autoFocus value={body} onChange={(e) => setBody(e.target.value)} rows={2} lang={compose === "note" ? "ko" : undefined}
              placeholder={compose === "comment" ? "Comment…" : "Translator's note…"} aria-label={compose === "comment" ? "Comment" : "Translator's note"}
              className="min-h-12 text-xs"
              onKeyDown={(e) => { if (e.key === "Escape") close(); if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void submit() }} />
            <div className="flex justify-end gap-1">
              <Button size="xs" variant="ghost" onClick={close}>Cancel</Button>
              <Button size="xs" onClick={() => void submit()} disabled={!body.trim()}>{compose === "comment" ? "Comment" : "Add note"}</Button>
            </div>
          </>
        ) : (
          <div className="flex gap-0.5">
            {sel.side === "source" && (
              <Button size="xs" variant="ghost" disabled={known}
                onClick={() => { void spell.setTerm({ term: sel.text, translation: "", aliases: "", kind: "other" }); close() }}>
                <IconBook2 data-icon="inline-start" /> {known ? "In glossary" : "Add to glossary"}
              </Button>
            )}
            <Button size="xs" variant="ghost" onClick={() => setCompose("comment")}>
              <IconMessage data-icon="inline-start" /> Comment
            </Button>
            {sel.side === "target" && (
              <Button size="xs" variant="ghost" onClick={() => setCompose("note")}>
                <IconNote data-icon="inline-start" /> Translator's note
              </Button>
            )}
            {unplaced.map((n) => (
              <Button key={n.id} size="xs" variant="ghost" title={n.bodySource ?? undefined}
                onClick={() => { void ann.actions.setNote(n.id, { targetAnchor: anchorOf() }); close() }}>
                <IconPinned data-icon="inline-start" /> Place note {ann.markers.get(n.id) ?? ""}
              </Button>
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
