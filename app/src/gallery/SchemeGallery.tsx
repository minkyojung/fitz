import { useState } from "react"

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { cn } from "cn"

type Scheme = "split" | "footnotes-tagged" | "endnotes-tagged"

const SCHEMES: { value: Scheme; label: string; blurb: string }[] = [
  { value: "split", label: "A · Author numbers, translator *", blurb: "Author's notes numbered and collected at the end; translator's notes as * footnotes on the page. CMOS 14.25." },
  { value: "footnotes-tagged", label: "B · All footnotes, one series", blurb: "Everything numbered in one series at the foot of the page; translator's notes end with —옮긴이. CMOS 14.53." },
  { value: "endnotes-tagged", label: "C · All endnotes, one series", blurb: "Same single series, but all notes collected at the end of the chapter or book." },
]

type Note = { kind: "author" | "translator"; quote: string; body: string }
const PARAS: { text: string; notes: Note[] }[] = [
  { text: "제무레이는 현지인들에게 부와 좋은 일자리를 가져다주겠다고 말했다. 사람을 뽑을 때가 되자 그는 통상 임금의 열 배를 제시했고, 다른 고용주들은 분개했다.",
    notes: [
      { kind: "author", quote: "부와 좋은 일자리", body: "제무레이 가족 인터뷰, 2010." },
      { kind: "translator", quote: "통상 임금", body: "1910년대 온두라스 농장 노동자의 일당은 약 25센트였다." },
    ] },
  { text: "몇 달 만에 그는 첫 농장이 될 미개간지를 그러모았다. 쿠야멜 강 삼각주, 마지막 포장도로 너머의 땅이었다.",
    notes: [
      { kind: "author", quote: "첫 농장", body: "Fortune, 1933년 3월호." },
      { kind: "translator", quote: "쿠야멜", body: "온두라스 북부 해안의 강과 지역 이름. 뒤에 회사명으로도 쓰인다." },
    ] },
]

/** How the same two paragraphs read under each note scheme: markers in the body, the foot of the page, the end. */
export function SchemeGallery() {
  const [scheme, setScheme] = useState<Scheme>("split")
  const info = SCHEMES.find((s) => s.value === scheme)!

  // assign markers
  let n = 0
  const symbols = ["*", "†", "‡"]
  let sym = 0
  const labelled = PARAS.map((p) => ({
    ...p,
    notes: p.notes.map((note) => ({ ...note, label: scheme === "split" ? (note.kind === "author" ? String(++n) : symbols[sym++ % 3]) : String(++n) })),
  }))
  const foot = labelled.flatMap((p) => p.notes).filter((x) => scheme === "footnotes-tagged" || (scheme === "split" && x.kind === "translator"))
  const end = labelled.flatMap((p) => p.notes).filter((x) => scheme === "endnotes-tagged" || (scheme === "split" && x.kind === "author"))
  const tag = (x: Note) => (scheme !== "split" && x.kind === "translator" ? " —옮긴이" : "")

  const body = (p: (typeof labelled)[number]) => {
    const out: React.ReactNode[] = []
    let pos = 0
    for (const note of p.notes) {
      const i = p.text.indexOf(note.quote, pos)
      const e = i + note.quote.length
      out.push(p.text.slice(pos, e))
      out.push(<sup key={note.label} className="ml-px text-[11px] font-medium text-mark-note-ink">{note.label}</sup>)
      pos = e
    }
    out.push(p.text.slice(pos))
    return out
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-8">
      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">Note schemes gallery</span>
        <ToggleGroup value={[scheme]} onValueChange={(v) => v[0] && setScheme(v[0] as Scheme)} size="sm" variant="outline" spacing={0}>
          {SCHEMES.map((s) => <ToggleGroupItem key={s.value} value={s.value}>{s.label}</ToggleGroupItem>)}
        </ToggleGroup>
        <span className="basis-full">{info.blurb}</span>
      </div>

      <div className="grid grid-cols-2 gap-6">
        {/* a printed page */}
        <div className="flex min-h-[520px] flex-col rounded-sm border bg-background p-8 shadow-sm">
          <div className="mb-3 text-[10px] text-muted-foreground">9 · 콜린스로</div>
          <div className="reading space-y-4 text-[15px]" lang="ko">
            {labelled.map((p, i) => <p key={i}>{body(p)}</p>)}
          </div>
          <div className="mt-auto pt-6">
            {foot.length > 0 && (
              <div className="border-t pt-2 text-[12px] leading-relaxed" lang="ko">
                {foot.map((x) => <p key={x.label}><sup className="mr-0.5 text-[10px]">{x.label}</sup>{x.body}{tag(x)}</p>)}
              </div>
            )}
            <div className="mt-3 text-center text-[10px] text-muted-foreground">67</div>
          </div>
        </div>

        {/* the end of the chapter / book */}
        <div className={cn("flex min-h-[520px] flex-col rounded-sm border bg-background p-8 shadow-sm", end.length === 0 && "opacity-40")}>
          <div className="mb-3 text-[10px] text-muted-foreground">{scheme === "split" ? "주 (저자 주)" : "주"}</div>
          {end.length ? (
            <div className="reading text-[13px] leading-relaxed" lang="ko">
              <div className="mb-2 text-[11px] font-medium text-muted-foreground">9장 콜린스로</div>
              {end.map((x) => <p key={x.label} className="mb-1"><span className="mr-1.5 tabular-nums">{x.label}</span>{x.body}{tag(x)}</p>)}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">Nothing collected at the end under this scheme.</p>
          )}
          <div className="mt-auto pt-6 text-center text-[10px] text-muted-foreground">283</div>
        </div>
      </div>
    </div>
  )
}
