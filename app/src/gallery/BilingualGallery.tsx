import { useMemo, useRef, useState } from "react"

import { Kbd } from "@/components/ui/kbd"
import { Toggle } from "@/components/ui/toggle"
import { formatSheets, sheets } from "@/lib/manuscript"
import { cn } from "cn"

type Status = "untranslated" | "draft" | "reviewed" | "final"
const DOT: Record<Status, string> = {
  untranslated: "bg-border", draft: "bg-muted-foreground/40", reviewed: "bg-mark-note", final: "bg-mark-term",
}

/** target is a list of blocks: one source paragraph ↔ one translation, which may be written as several blocks. */
const ROWS: { page: number; kind: string; source: string; target: string[]; status: Status }[] = [
  { page: 11, kind: "heading", source: "Selma", target: ["셀마"], status: "final" },
  { page: 11, kind: "paragraph", status: "reviewed",
    source: "Sam Zemurray saw his first banana in 1893. In the lore, this is presented as a moment of clarity, wherein the future was revealed. In some versions, the original banana is presented as a platonic ideal, an archetype circling the young man’s head.",
    target: ["샘 제무레이가 처음 바나나를 본 것은 1893년이었다. 전해지는 이야기에서 이 순간은 앞날이 환히 드러난 깨달음의 순간으로 그려진다.", "어떤 판본에서는 그 첫 바나나가 플라톤적 이데아처럼, 젊은이의 머리 위를 맴도는 원형으로 묘사된다."] },
  { page: 11, kind: "paragraph", status: "draft",
    source: "The most likely version has Sam seeing that first banana in the wares of a peddler in the alley behind his uncle’s store in Selma. The American banana trade had begun twenty years before, but it was still embryonic.",
    target: ["가장 그럴듯한 판본은 샘이 셀마에 있는 삼촌 가게 뒷골목, 행상의 좌판에서 그 첫 바나나를 보았다는 것이다. 미국의 바나나 무역은 이십 년 전에 시작되었지만 아직 걸음마 단계였다."] },
  { page: 12, kind: "paragraph", status: "untranslated",
    source: "Few people had ever seen a banana. If they were spoken of at all, it was as an oddity, the way a person might speak of an African cucumber today.",
    target: [] },
  { page: 12, kind: "blockquote", status: "untranslated",
    source: "“What are those?” he asked, pointing to the fruit piled on the wharf.",
    target: [] },
  { page: 12, kind: "paragraph", status: "untranslated",
    source: "“Bananas,” said the captain. He had never seen one before and wanted to try.",
    target: [] },
]

/** Bilingual-book view: source on the left page, translation on the right, paragraphs facing each other.
 *  No cells, no per-row toolbar. The caret flows between paragraphs; Enter adds a block inside the same pair;
 *  ⌘Enter confirms and moves on. Status is a dot in the gutter. */
export function BilingualGallery() {
  const [rows, setRows] = useState(ROWS)
  const [active, setActive] = useState<number | null>(null)
  const [focusMode, setFocusMode] = useState(false)
  const cells = useRef<(HTMLDivElement | null)[]>([])
  const total = useMemo(() => sheets(rows.flatMap((r) => r.target).join("\n")), [rows])

  const focusCell = (i: number, where: "start" | "end") => {
    const el = cells.current[i]
    if (!el) return
    el.focus()
    const sel = window.getSelection()!
    const range = document.createRange()
    range.selectNodeContents(el)
    range.collapse(where === "start")
    sel.removeAllRanges(); sel.addRange(range)
  }
  const caretAtEdge = (el: HTMLElement, edge: "start" | "end") => {
    const sel = window.getSelection()
    if (!sel?.rangeCount) return false
    const r = sel.getRangeAt(0).cloneRange()
    const probe = document.createRange(); probe.selectNodeContents(el)
    if (edge === "start") { probe.setEnd(r.startContainer, r.startOffset); return probe.toString().length === 0 }
    probe.setStart(r.endContainer, r.endOffset); return probe.toString().length === 0
  }
  const commit = (i: number) => {
    const el = cells.current[i]; if (!el) return
    const blocks = Array.from(el.querySelectorAll("p")).map((p) => p.textContent?.trim() ?? "").filter(Boolean)
    setRows((rs) => rs.map((r, k) => k === i ? { ...r, target: blocks, status: !blocks.length ? "untranslated" : r.status === "untranslated" ? "draft" : r.status } : r))
  }

  return (
    <div className="mx-auto max-w-5xl p-8">
      <div className="mb-4 flex items-center gap-3 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">Bilingual view gallery</span>
        <span className="flex items-center gap-1"><Kbd>↑</Kbd><Kbd>↓</Kbd> flow between paragraphs <Kbd>Enter</Kbd> new block in the same pair <Kbd>⌘Enter</Kbd> confirm &amp; next</span>
        <span className="ml-auto tabular-nums">{formatSheets(total)}</span>
        <Toggle size="sm" variant="outline" pressed={focusMode} onPressedChange={setFocusMode}>Focus</Toggle>
      </div>
      <div className="grid grid-cols-[1rem_1fr_1fr] gap-x-8">
        {rows.map((r, i) => {
          const dim = focusMode && active !== null && active !== i
          return (
            <div key={i} className={cn("col-span-3 grid grid-cols-subgrid border-b border-border/60 py-3 transition-opacity", dim && "opacity-30")}>
              <div className="pt-2"><span className={cn("block size-2 rounded-full", DOT[r.status])} title={r.status} /></div>
              <p className={cn("reading text-[15px] text-muted-foreground", r.kind === "heading" && "font-semibold text-foreground")} lang="en">{r.source}</p>
              <div
                ref={(el) => { cells.current[i] = el }}
                lang="ko"
                contentEditable
                suppressContentEditableWarning
                data-placeholder="Translate…"
                className={cn(
                  "reading min-w-0 text-[15px] outline-none empty:before:text-muted-foreground/50 empty:before:content-[attr(data-placeholder)] [&_p+p]:mt-3",
                  r.kind === "heading" && "font-semibold",
                )}
                onFocus={() => setActive(i)}
                onBlur={() => { commit(i); setActive(null) }}
                onKeyDown={(e) => {
                  const el = e.currentTarget
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault(); commit(i)
                    setRows((rs) => rs.map((x, k) => k === i && x.target.length ? { ...x, status: "reviewed" } : x))
                    const next = rows.findIndex((x, k) => k > i && x.status !== "reviewed" && x.status !== "final")
                    if (next !== -1) focusCell(next, "end")
                  } else if (e.key === "ArrowDown" && caretAtEdge(el, "end") && i < rows.length - 1) { e.preventDefault(); focusCell(i + 1, "start") }
                  else if (e.key === "ArrowUp" && caretAtEdge(el, "start") && i > 0) { e.preventDefault(); focusCell(i - 1, "end") }
                  else if (e.key === "Tab") { e.preventDefault(); focusCell(e.shiftKey ? Math.max(0, i - 1) : Math.min(rows.length - 1, i + 1), "end") }
                }}
              >
                {r.target.map((t, k) => <p key={k}>{t}</p>)}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
