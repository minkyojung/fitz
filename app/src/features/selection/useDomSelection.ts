import { useEffect } from "react"

import type { TextSelection } from "@/lib/selection"
import { useSelectionState } from "./SelectionContext"

/** Adapter: DOM selections inside read-only blocks (source `p[lang=en]`, translation `[data-target]`). */
export function useDomSelection(paused: boolean) {
  const state = useSelectionState()
  useEffect(() => {
    if (!state) return
    const read = () => {
      if (paused) return
      const s = window.getSelection()
      if (!s || s.isCollapsed || s.rangeCount === 0) { if (!paused) state.publish(null); return }
      const range = s.getRangeAt(0)
      const node = range.commonAncestorContainer
      const el = node instanceof Element ? node : node.parentElement
      if (!el || el.closest(".ProseMirror") || el.closest("[data-floating-toolbar]")) return // the editor adapter owns those
      const block = el.closest('p[lang="en"], [data-target]') as HTMLElement | null
      const row = el.closest("[data-segment], [data-pair]") as HTMLElement | null
      const text = s.toString().trim()
      if (!block || !row || !text || text.length > 200 || /\n/.test(text)) { state.publish(null); return }
      const pre = document.createRange(); pre.selectNodeContents(block); pre.setEnd(range.startContainer, range.startOffset)
      const start = pre.toString().length
      const r = range.getBoundingClientRect()
      const sel: TextSelection = {
        segmentId: Number(row.getAttribute("data-segment") ?? row.getAttribute("data-pair")),
        side: block.matches("[data-target]") ? "target" : "source",
        text, start, end: start + text.length,
        rect: { x: r.x, y: r.y, width: r.width, height: r.height },
        origin: "dom",
      }
      state.publish(sel)
    }
    document.addEventListener("selectionchange", read)
    return () => document.removeEventListener("selectionchange", read)
  }, [state, paused])
}
