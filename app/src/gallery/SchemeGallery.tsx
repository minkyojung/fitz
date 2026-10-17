import { useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "cn"

type Scheme = "split" | "single" | "single-tagged"

const SCHEMES: { value: Scheme; label: string; blurb: string }[] = [
  { value: "split", label: "A · Author 1 2, translator *", blurb: "Author's notes numbered, every translator's note marked *. The kind is visible in the text itself; print restarts symbols per page, so the app needs no † ‡. CMOS 14.25." },
  { value: "single", label: "B · One series", blurb: "Everything numbered in one series; the kind shows only in the Notes panel." },
  { value: "single-tagged", label: "C · One series, —옮긴이", blurb: "One series, and the translator's notes end with —옮긴이 as they will in print. CMOS 14.53." },
]

type Note = { id: number; kind: "author" | "translator"; quote: string; body: string }
const PAIRS: { source: string; target: string; notes: Note[] }[] = [
  {
    source: "Zemurray told the locals he would bring them wealth and good jobs. When it came time to hire, he offered a wage ten times the going rate, which angered other employers.",
    target: "제무레이는 현지인들에게 부와 좋은 일자리를 가져다주겠다고 말했다. 사람을 뽑을 때가 되자 그는 통상 임금의 열 배를 제시했고, 다른 고용주들은 분개했다.",
    notes: [
      { id: 1, kind: "author", quote: "부와 좋은 일자리", body: "Interview with the Zemurray family, 2010." },
      { id: 2, kind: "translator", quote: "통상 임금", body: "1910년대 온두라스 농장 노동자의 일당은 약 25센트였다." },
    ],
  },
  {
    source: "Within months he had assembled the wilderness that would become his first plantation: the Cuyamel River delta, beyond the last paved road.",
    target: "몇 달 만에 그는 첫 농장이 될 미개간지를 그러모았다. 쿠야멜 강 삼각주, 마지막 포장도로 너머의 땅이었다.",
    notes: [
      { id: 3, kind: "author", quote: "첫 농장", body: "Fortune, March 1933." },
      { id: 4, kind: "translator", quote: "쿠야멜", body: "온두라스 북부 해안의 강과 지역 이름. 뒤에 회사명으로도 쓰인다." },
    ],
  },
]

/** The editor's bilingual rows and Notes panel under each marker scheme. Only the labels change; placement is the designers' job. */
export function SchemeGallery() {
  const [scheme, setScheme] = useState<Scheme>("split")
  const [selected, setSelected] = useState<number | null>(null)
  const info = SCHEMES.find((s) => s.value === scheme)!

  const all = PAIRS.flatMap((p) => p.notes)
  const labels = new Map<number, string>()
  let n = 0
  for (const note of all) labels.set(note.id, scheme === "split" && note.kind === "translator" ? "*" : String(++n))
  const tag = (x: Note) => (scheme === "single-tagged" && x.kind === "translator" ? " —옮긴이" : "")

  const marked = (p: (typeof PAIRS)[number]) => {
    const out: React.ReactNode[] = []
    let pos = 0
    for (const note of p.notes) {
      const i = p.target.indexOf(note.quote, pos)
      const e = i + note.quote.length
      out.push(p.target.slice(pos, e))
      out.push(
        <Tooltip key={note.id}>
          <TooltipTrigger render={<sup data-note onClick={() => setSelected(note.id)} className={cn("ml-px cursor-pointer border-b-2 border-mark-note bg-mark-note/40 px-0.5 text-[11px] font-medium text-mark-note-ink transition-colors hover:bg-mark-note/70", selected === note.id && "bg-mark-note/70")} />}>
            {labels.get(note.id)}
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-xs px-2.5 py-1.5 text-[13px] leading-normal">
            <span className="reading" lang={note.kind === "author" ? "en" : "ko"}>{note.body}{tag(note)}</span>
          </TooltipContent>
        </Tooltip>,
      )
      pos = e
    }
    out.push(p.target.slice(pos))
    return out
  }

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-8">
      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">Note schemes gallery</span>
        <ToggleGroup value={[scheme]} onValueChange={(v) => v[0] && setScheme(v[0] as Scheme)} size="sm" variant="outline" spacing={0}>
          {SCHEMES.map((s) => <ToggleGroupItem key={s.value} value={s.value}>{s.label}</ToggleGroupItem>)}
        </ToggleGroup>
        <span className="basis-full">{info.blurb}</span>
      </div>

      <div className="grid grid-cols-[1fr_320px] gap-6">
        <div className="space-y-6">
          {PAIRS.map((p, i) => (
            <div key={i} className="grid grid-cols-[1rem_1fr_1fr] gap-x-6">
              <div className="pt-2"><span className="block size-2 rounded-full bg-mark-note" /></div>
              <p className="reading select-text text-[15px] text-muted-foreground" lang="en">{p.source}</p>
              <div className="reading text-[15px]" lang="ko">{marked(p)}</div>
            </div>
          ))}
        </div>

        <aside className="flex flex-col rounded-md border">
          <div className="flex h-8 items-center gap-2 border-b px-3 text-xs">
            <span className="font-medium">Notes</span>
            <Badge variant="outline">{all.length}</Badge>
          </div>
          <ul className="divide-y text-xs">
            {all.map((x) => (
              <li key={x.id} className={cn("space-y-1 border-l-2 border-transparent px-3 py-2", selected === x.id && "border-mark-note bg-muted")} onClick={() => setSelected(x.id)}>
                <div className="flex items-center gap-2">
                  <sup className="border-b-2 border-mark-note bg-mark-note/40 px-0.5 text-[11px] font-medium text-mark-note-ink">{labels.get(x.id)}</sup>
                  <span className="text-muted-foreground">{x.kind === "author" ? "Author's note" : "Translator's note"}</span>
                  <span className="ml-auto truncate text-muted-foreground" lang="ko">“{x.quote}”</span>
                </div>
                {x.kind === "translator"
                  ? <div className="flex flex-col gap-1"><Textarea defaultValue={x.body} className="min-h-8 text-xs" rows={2} lang="ko" />{tag(x) && <span className="text-muted-foreground">Exported as “…{tag(x).trim()}”</span>}</div>
                  : <p className="text-muted-foreground" lang="en">{x.body}</p>}
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </div>
  )
}
