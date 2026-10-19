import { useEffect, useEffectEvent, useState } from "react"
import { IconBook2, IconCards, IconMessage, IconNote, IconPinned, IconSparkles } from "@tabler/icons-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Kbd } from "@/components/ui/kbd"
import { Popover, PopoverContent } from "@/components/ui/popover"
import { Textarea } from "@/components/ui/textarea"
import { api } from "@/data/http"
import { locateAnchor, makeAnchor } from "@/lib/anchor"
import type { Pointed } from "@/lib/conversation"
import type { TextSelection } from "@/lib/selection"
import { useSpell } from "@/features/review/SpellContext"
import { useAnnotations } from "@/features/notes/AnnotationsContext"
import { useSelectionState } from "./SelectionContext"
import { useDomSelection } from "./useDomSelection"

/** Which words a selection covers, for telling whether a press changed it. */
const rangeKey = (s: TextSelection | null) => (s ? `${s.origin} ${s.segmentId} ${s.side} ${s.start}-${s.end}` : "")

/** One toolbar for every selection, wherever it was made (read-only block or the open editor).
 *  A shadcn Popover anchored to the selection rectangle; the popover handles placement and collisions. */
export function FloatingToolbar({ blockText, onAsk }: {
  blockText: (segmentId: number, side: "source" | "target") => string
  /** Ask Claude about the selected words (docs/agent.md §17). */
  onAsk: (pointed: Pointed) => void
}) {
  const state = useSelectionState()
  const spell = useSpell()
  const ann = useAnnotations()
  const [compose, setCompose] = useState<"comment" | "note" | null>(null)
  const [body, setBody] = useState("")
  useDomSelection(compose !== null)

  const sel = state?.selection ?? null
  // Shown once the mouse button is let go, not while it drags over the words the toolbar would cover: a selection that
  // changed since the button went down is still being made. A press that leaves it as it was (on the toolbar, inside it) keeps it.
  const [pressedOn, setPressedOn] = useState<string | null>(null) // the selection when the button went down; null while none is
  const onPress = useEffectEvent((e: PointerEvent) => { if (e.button === 0) setPressedOn(rangeKey(sel)) })
  useEffect(() => {
    const down = (e: PointerEvent) => onPress(e)
    const up = () => setPressedOn(null)
    const ends = ["pointerup", "pointercancel", "contextmenu"] // ⌃-click's menu swallows the release
    window.addEventListener("pointerdown", down, true)
    for (const t of ends) window.addEventListener(t, up, true)
    return () => { window.removeEventListener("pointerdown", down, true); for (const t of ends) window.removeEventListener(t, up, true) }
  }, [])
  const selecting = pressedOn !== null && pressedOn !== rangeKey(sel) && !compose // a comment being written stays put
  useEffect(() => { if (!sel) { setCompose(null); setBody("") } }, [sel])

  if (!sel || !spell || !ann || selecting) return null
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
        anchor={sel.anchor} // the popover measures the words on every scroll of the list they are in
        side="bottom"
        align="center"
        sideOffset={6}
        data-floating-toolbar
        data-quote={sel.text}
        initialFocus={false}
        finalFocus={false}
        // the buttons go out of sight with their words; a comment being written never does (hidden, it would lose the
        // focus, and the keys typed next would fall to the list's shortcuts)
        className={compose ? "w-72 gap-1.5 p-2" : "w-auto gap-0 p-1 in-data-anchor-hidden:invisible"}
        onMouseDown={(e) => { if (!(e.target as HTMLElement).closest("textarea")) e.preventDefault() }} // keep the text selection
      >
        {compose ? (
          <>
            <Textarea autoFocus value={body} onChange={(e) => setBody(e.target.value)} rows={2} lang={compose === "note" ? "ko" : undefined}
              placeholder={compose === "comment" ? "Comment…" : "Translator's note…"} aria-label={compose === "comment" ? "Comment" : "Translator's note"}
              className="min-h-12 text-xs"
              onKeyDown={(e) => { if (e.key === "Escape") close(); if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void submit() }} />
            <div className="flex justify-end gap-1">
              <Button size="sm" variant="ghost" onClick={close}>Cancel</Button>
              <Button size="sm" onClick={() => void submit()} disabled={!body.trim()}>{compose === "comment" ? "Comment" : "Add note"}</Button>
            </div>
          </>
        ) : (
          <div className="flex gap-0.5">
            {sel.side === "source" && (
              <Button variant="ghost" disabled={known}
                onClick={() => { void spell.setTerm({ term: sel.text, translation: "", aliases: "", kind: "other" }); close() }}>
                <IconBook2 data-icon="inline-start" /> {known ? "In glossary" : "Add to glossary"}
              </Button>
            )}
            <Button variant="ghost" onClick={() => setCompose("comment")}>
              <IconMessage data-icon="inline-start" /> Comment
            </Button>
            {sel.side === "target" && (
              <Button variant="ghost" onClick={() => setCompose("note")}>
                <IconNote data-icon="inline-start" /> Translator's note
              </Button>
            )}
            <Button variant="ghost" onClick={() => { onAsk({ segmentId: sel.segmentId, side: sel.side, quote: sel.text }); close() }}>
              <IconSparkles data-icon="inline-start" /> Ask Claude <Kbd className="ml-0.5">⌘L</Kbd>
            </Button>
            {sel.side === "source" && (
              <Button variant="ghost" onClick={() => {
                const quote = sel.text
                api.pickWords({ segmentId: sel.segmentId, quote, origin: "picked" }).then(
                  () => toast(`“${quote}” will be in Session`, { description: "Claude makes a card on it with the evening's." }),
                  (e) => toast.error(`“${quote}” could not be added to Session`, { description: (e as Error).message }),
                )
                close()
              }}>
                <IconCards data-icon="inline-start" /> Add to Session
              </Button>
            )}
            {unplaced.map((n) => (
              <Button key={n.id} variant="ghost" title={n.bodySource ?? undefined}
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
