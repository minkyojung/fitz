import { useEffect, useState } from "react"
import { IconBook2, IconMessage, IconNote } from "@tabler/icons-react"

import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { makeAnchor } from "@/lib/anchor"
import type { TextAnchor } from "@/data/api"
import { useSpell } from "./SpellContext"
import { useAnnotations } from "@/features/notes/AnnotationsContext"

type Sel = { text: string; x: number; y: number; side: "source" | "target"; segmentId: number; anchor: TextAnchor }

/** Floating actions for a selection in a read-only paragraph: add to glossary (source), comment (both),
 *  translator's note (translation). Writing happens in a small composer right under the buttons. */
export function SelectionToolbar() {
  const spell = useSpell()
  const ann = useAnnotations()
  const [sel, setSel] = useState<Sel | null>(null)
  const [compose, setCompose] = useState<"comment" | "note" | null>(null)
  const [body, setBody] = useState("")

  useEffect(() => {
    const read = () => {
      if (compose) return // keep the selection while typing in the composer
      const s = window.getSelection()
      if (!s || s.isCollapsed || s.rangeCount === 0) { setSel(null); return }
      const range = s.getRangeAt(0)
      const node = range.commonAncestorContainer
      const el = node instanceof Element ? node : node.parentElement
      if (!el || el.closest(".ProseMirror") || el.closest("[data-selection-toolbar]")) { setSel(null); return }
      const block = el.closest('p[lang="en"], [data-target]') as HTMLElement | null
      const row = el.closest("[data-segment], [data-pair]") as HTMLElement | null
      const text = s.toString().trim()
      if (!block || !row || !text || text.length > 200 || /\n/.test(text)) { setSel(null); return }
      const side = block.matches("[data-target]") ? "target" : "source"
      const segmentId = Number(row.getAttribute("data-segment") ?? row.getAttribute("data-pair"))
      // offsets within the block's text (the stored anchor relocates by quote + context anyway)
      const pre = document.createRange(); pre.selectNodeContents(block); pre.setEnd(range.startContainer, range.startOffset)
      const start = pre.toString().length
      const full = block.textContent ?? ""
      const r = range.getBoundingClientRect()
      setSel({ text, x: r.left + r.width / 2, y: r.top, side, segmentId, anchor: makeAnchor(full, start, start + text.length) })
    }
    document.addEventListener("selectionchange", read)
    return () => document.removeEventListener("selectionchange", read)
  }, [compose])

  if (!sel || !spell || !ann) return null
  const known = spell.glossary.some((t) => t.term.toLowerCase() === sel.text.toLowerCase())
  const close = () => { setCompose(null); setBody(""); setSel(null); window.getSelection()?.removeAllRanges() }
  const submit = async () => {
    if (!body.trim()) return
    if (compose === "comment") await ann.actions.addComment(sel.segmentId, sel.side, sel.anchor, body.trim())
    else await ann.actions.addNote(sel.segmentId, sel.anchor, body.trim())
    close()
  }

  return (
    <div data-selection-toolbar className="fixed z-30 -translate-x-1/2 -translate-y-full pb-1" style={{ left: sel.x, top: sel.y }}
      onMouseDown={(e) => { if (!(e.target as HTMLElement).closest("textarea")) e.preventDefault() }}>
      {compose ? (
        <div className="w-72 space-y-1.5 rounded-md border bg-popover p-2 shadow-md">
          <Textarea autoFocus value={body} onChange={(e) => setBody(e.target.value)} rows={2} lang={compose === "note" ? "ko" : undefined}
            placeholder={compose === "comment" ? "Comment…" : "Translator's note…"} aria-label={compose === "comment" ? "Comment" : "Translator's note"}
            className="min-h-12 text-xs"
            onKeyDown={(e) => { if (e.key === "Escape") close(); if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void submit() }} />
          <div className="flex justify-end gap-1">
            <Button size="xs" variant="ghost" onClick={close}>Cancel</Button>
            <Button size="xs" onClick={() => void submit()} disabled={!body.trim()}>{compose === "comment" ? "Comment" : "Add note"}</Button>
          </div>
        </div>
      ) : (
        <div className="flex gap-1">
          {sel.side === "source" && (
            <Button size="xs" variant="outline" className="shadow-sm" disabled={known}
              onClick={() => { void spell.setTerm({ term: sel.text, translation: "", aliases: "", kind: "other" }); close() }}>
              <IconBook2 data-icon="inline-start" /> {known ? "In glossary" : "Add to glossary"}
            </Button>
          )}
          <Button size="xs" variant="outline" className="shadow-sm" onClick={() => setCompose("comment")}>
            <IconMessage data-icon="inline-start" /> Comment
          </Button>
          {sel.side === "target" && (
            <Button size="xs" variant="outline" className="shadow-sm" onClick={() => setCompose("note")}>
              <IconNote data-icon="inline-start" /> Translator's note
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
