import { useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "cn"

/** Translating an author's note: the Notes panel shows the English original read-only and a field for the Korean
 *  under it. Translated notes export in Korean; untranslated ones go out in English and are counted in the export warnings. */
const SOURCE = "Zemurray told the locals he would bring them wealth and good jobs. When it came time to hire, he offered a wage ten times the going rate."
const TARGET = "제무레이는 현지인들에게 부와 좋은 일자리를 가져다주겠다고 말했다. 사람을 뽑을 때가 되자 그는 통상 임금의 열 배를 제시했다."

type Note = { id: number; kind: "author" | "translator"; src?: string; tgt?: string; original?: string; body: string }

export function AuthorNoteGallery() {
  const [notes, setNotes] = useState<Note[]>([
    { id: 1, kind: "author", src: "wealth and good jobs", tgt: "부와 좋은 일자리", original: "Interview with the Zemurray family, 2010.", body: "제무레이 가족 인터뷰, 2010." },
    { id: 2, kind: "author", src: "ten times the going rate", original: "Fortune, March 1933. The figure is disputed; see chapter 9.", body: "" },
    { id: 3, kind: "translator", tgt: "통상 임금", body: "1910년대 온두라스 농장 노동자의 일당은 약 25센트였다." },
  ])
  const [selected, setSelected] = useState<number | null>(2)
  const label = (n: Note) => (n.kind === "author" ? String(notes.filter((x) => x.kind === "author").indexOf(n) + 1) : "*")
  const untranslated = notes.filter((n) => n.kind === "author" && !n.body.trim()).length

  const Sup = ({ n, provisional = false }: { n: Note; provisional?: boolean }) => (
    <Tooltip>
      <TooltipTrigger render={<sup onClick={() => setSelected(n.id)} className={cn("ml-px cursor-pointer border-b-2 px-0.5 text-[11px] font-medium transition-colors",
        provisional ? "border-dashed border-muted-foreground/50 bg-muted text-muted-foreground" : "border-mark-note bg-mark-note/40 text-mark-note-ink hover:bg-mark-note/70", selected === n.id && !provisional && "bg-mark-note/70")} />}>
        {label(n)}
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs px-2.5 py-1.5 text-[13px] leading-normal">
        {provisional && <div className="mb-0.5 text-[11px] opacity-70">Not placed yet — select the words in the translation, then “Place note”</div>}
        <span className="reading text-[13px] leading-normal" lang={n.body ? "ko" : "en"}>{n.body || n.original}</span>
      </TooltipContent>
    </Tooltip>
  )
  const mark = (text: string, side: "source" | "target") => {
    const items = notes.flatMap((n) => { const q = side === "source" ? n.src : n.tgt; const at = q ? text.indexOf(q) : -1; return at >= 0 ? [{ at: at + q!.length, n }] : [] }).sort((a, b) => a.at - b.at)
    const out: React.ReactNode[] = []
    let pos = 0
    for (const x of items) { out.push(text.slice(pos, x.at)); out.push(<Sup key={x.n.id} n={x.n} />); pos = x.at }
    out.push(text.slice(pos))
    if (side === "target") for (const n of notes) if (n.kind === "author" && !n.tgt) out.push(<Sup key={"p" + n.id} n={n} provisional />)
    return out
  }

  return (
    <div className="mx-auto grid max-w-6xl grid-cols-[1fr_340px] gap-6 p-8">
      <div>
        <h1 className="mb-4 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Author's note translation gallery</span>
          <span>hover a number for the note · click it to open it in the panel · the field under the English takes the Korean</span>
        </h1>
        <div className="grid grid-cols-[1rem_1fr_1fr] gap-x-6">
          <div className="pt-2"><span className="block size-2 rounded-full bg-mark-note" /></div>
          <p className="reading select-text text-[15px] text-muted-foreground" lang="en">{mark(SOURCE, "source")}</p>
          <div className="reading text-[15px]" lang="ko">{mark(TARGET, "target")}</div>
        </div>
        <p className="mt-8 text-xs text-muted-foreground">In the Export tab this shows up as:</p>
        <div className="mt-1 inline-block rounded-md border px-3 py-2 text-xs">
          <span className="text-muted-foreground">Notes</span> <span className="ml-3 tabular-nums">2 author's, 1 translator's</span>
          <span className="text-muted-foreground"> (1 not placed, <span className={cn(untranslated && "text-mark-warning-ink")}>{untranslated} untranslated</span>)</span>
        </div>
      </div>

      <aside className="flex flex-col rounded-md border">
        <div className="flex h-8 items-center gap-2 border-b px-3 text-xs">
          <span className="font-medium">Notes</span>
          <Badge variant="outline">{notes.length}</Badge>
          {untranslated > 0 && <Badge variant="secondary" className="ml-auto">{untranslated} note{untranslated > 1 ? "s" : ""} untranslated</Badge>}
        </div>
        <ul className="divide-y text-xs">
          {notes.map((n) => (
            <li key={n.id} className={cn("space-y-1.5 border-l-2 border-transparent px-3 py-2", selected === n.id && "border-mark-note bg-muted")} onClick={() => setSelected(n.id)}>
              <div className="flex items-center gap-2">
                <sup className={cn("border-b-2 px-0.5 text-[11px] font-medium", n.kind === "author" && !n.tgt ? "border-dashed border-muted-foreground/50 bg-muted text-muted-foreground" : "border-mark-note bg-mark-note/40 text-mark-note-ink")}>{label(n)}</sup>
                <span className="text-muted-foreground">{n.kind === "author" ? "Author's note" : "Translator's note"}</span>
                <span className="ml-auto truncate text-muted-foreground" lang={n.tgt ? "ko" : "en"}>{n.tgt ? `“${n.tgt}”` : n.kind === "author" ? "not placed" : ""}</span>
              </div>
              {n.kind === "author" && <p className="reading text-[13px] leading-normal text-muted-foreground" lang="en">{n.original}</p>}
              <Textarea value={n.body} lang="ko" rows={2} className="min-h-8 text-xs" onClick={(e) => e.stopPropagation()}
                placeholder={n.kind === "author" ? "Translation of the note… (exported in English until you do)" : "Translator's note…"}
                onChange={(e) => setNotes((ns) => ns.map((x) => (x.id === n.id ? { ...x, body: e.target.value } : x)))} />
            </li>
          ))}
        </ul>
      </aside>
    </div>
  )
}
