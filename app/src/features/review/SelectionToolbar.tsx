import { useEffect, useState } from "react"
import { IconBook2 } from "@tabler/icons-react"

import { Button } from "@/components/ui/button"
import { useSpell } from "./SpellContext"

/** Small floating action when a word or phrase is selected inside a source paragraph: add it to the glossary. */
export function SelectionToolbar() {
  const spell = useSpell()
  const [sel, setSel] = useState<{ text: string; x: number; y: number } | null>(null)

  useEffect(() => {
    const read = () => {
      const s = window.getSelection()
      if (!s || s.isCollapsed || s.rangeCount === 0) { setSel(null); return }
      const range = s.getRangeAt(0)
      const el = range.commonAncestorContainer instanceof Element ? range.commonAncestorContainer : range.commonAncestorContainer.parentElement
      const inSource = el?.closest('p[lang="en"]:not([contenteditable="true"])') && !el?.closest(".ProseMirror")
      const text = s.toString().trim()
      if (!inSource || !text || text.length > 60 || /\n/.test(text)) { setSel(null); return }
      const r = range.getBoundingClientRect()
      setSel({ text, x: r.left + r.width / 2, y: r.top })
    }
    document.addEventListener("selectionchange", read)
    return () => document.removeEventListener("selectionchange", read)
  }, [])

  if (!sel || !spell) return null
  const known = spell.glossary.some((t) => t.term.toLowerCase() === sel.text.toLowerCase())
  return (
    <div
      data-selection-toolbar
      className="fixed z-30 -translate-x-1/2 -translate-y-full pb-1"
      style={{ left: sel.x, top: sel.y }}
      onMouseDown={(e) => e.preventDefault()} // keep the selection
    >
      <Button size="xs" variant="outline" className="shadow-sm" disabled={known}
        onClick={() => { void spell.setTerm({ term: sel.text, translation: "", aliases: "", kind: "other" }); setSel(null); window.getSelection()?.removeAllRanges() }}>
        <IconBook2 data-icon="inline-start" /> {known ? "In glossary" : "Add to glossary"}
      </Button>
    </div>
  )
}
