import { useState } from "react"
import { IconCheck, IconMessage, IconNote } from "@tabler/icons-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "cn"

/** One pair with a comment on the source, a comment + a translator's note on the target, and an author footnote. */
const SOURCE = "Zemurray told the locals he would bring them wealth and good jobs. When it came time to hire, he offered a wage ten times the going rate, which angered other employers."
const TARGET = "제무레이는 현지인들에게 부와 좋은 일자리를 가져다주겠다고 말했다. 사람을 뽑을 때가 되자 그는 통상 임금의 열 배를 제시했고, 다른 고용주들은 분개했다."

type Comment = { id: number; side: "source" | "target"; quote: string; body: string; resolved: boolean; replies: { body: string }[] }
type Note = { id: number; kind: "author" | "translator"; quote: string; body: string }

export function NotesGallery() {
  const [comments, setComments] = useState<Comment[]>([
    { id: 1, side: "source", quote: "ten times the going rate", body: "Check the Fortune article — is it ten times or three?", resolved: false, replies: [{ body: "Fortune (1933) says ten. Keep." }] },
    { id: 2, side: "target", quote: "분개했다", body: "'분노했다'가 더 자연스러울까?", resolved: false, replies: [] },
  ])
  const notes: Note[] = [
    { id: 1, kind: "author", quote: "부와 좋은 일자리", body: "Interview with the Zemurray family, 2010." },
    { id: 2, kind: "translator", quote: "통상 임금", body: "1910년대 온두라스 농장 노동자의 일당은 약 25센트였다." },
  ]
  const [selected, setSelected] = useState<number | null>(1)
  const open = comments.filter((c) => !c.resolved).length

  const mark = (text: string, side: "source" | "target") => {
    // overlays in document order: comment highlights and footnote numbers after their quotes
    const items = [
      ...comments.filter((c) => c.side === side && !c.resolved).map((c) => ({ at: text.indexOf(c.quote), len: c.quote.length, kind: "comment" as const, c })),
      ...notes.filter(() => side === "target").map((n, i) => ({ at: text.indexOf(n.quote), len: n.quote.length, kind: "note" as const, n, num: i + 1 })),
    ].filter((x) => x.at >= 0).sort((a, b) => a.at - b.at)
    const out: React.ReactNode[] = []
    let pos = 0
    for (const x of items) {
      if (x.at < pos) continue
      out.push(text.slice(pos, x.at))
      if (x.kind === "comment") {
        out.push(
          <mark key={"c" + x.c.id} data-comment onClick={() => setSelected(x.c.id)}
            className={cn("cursor-pointer rounded-sm bg-mark-italic text-inherit", selected === x.c.id && "ring-2 ring-mark-italic")}>
            {text.slice(x.at, x.at + x.len)}
          </mark>,
        )
      } else {
        out.push(text.slice(x.at, x.at + x.len))
        out.push(
          <Tooltip key={"n" + x.n.id}>
            <TooltipTrigger render={<sup data-note className="ml-px cursor-pointer rounded-sm bg-mark-note px-0.5 text-[11px] font-medium" />}>
              {x.num}{x.n.kind === "translator" && <span className="opacity-60">T</span>}
            </TooltipTrigger>
            <TooltipContent side="top">{x.n.kind === "author" ? "Author's note" : "Translator's note"}: {x.n.body}</TooltipContent>
          </Tooltip>,
        )
      }
      pos = x.at + x.len
    }
    out.push(text.slice(pos))
    return out
  }

  return (
    <div className="mx-auto grid max-w-6xl grid-cols-[1fr_320px] gap-6 p-8">
      <div>
        <h1 className="mb-4 flex items-center gap-3 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Comments &amp; notes gallery</span>
          <span>purple = comment (click to open) · blue superscript = footnote (T = translator's) · yellow stays for edits · hover for text</span>
        </h1>
        <div className="grid grid-cols-[1rem_1fr_1fr] gap-x-6">
          <div className="pt-2"><span className="block size-2 rounded-full bg-mark-note" /></div>
          <p className="reading select-text text-[15px] text-muted-foreground" lang="en">{mark(SOURCE, "source")}</p>
          <div className="reading text-[15px]" lang="ko">{mark(TARGET, "target")}</div>
        </div>
        <p className="mt-6 text-xs text-muted-foreground">Selecting text shows the floating toolbar:</p>
        <div className="mt-1 flex gap-1">
          <Button size="xs" variant="outline"><IconMessage data-icon="inline-start" /> Comment</Button>
          <Button size="xs" variant="outline"><IconNote data-icon="inline-start" /> Translator's note</Button>
        </div>
      </div>

      <aside className="flex flex-col rounded-md border">
        <div className="flex h-8 items-center gap-2 border-b px-3 text-xs">
          <span className="font-medium">Notes</span>
          <Badge variant={open ? "secondary" : "outline"}>{open} open</Badge>
        </div>
        <ul className="divide-y text-xs">
          {comments.map((c) => (
            <li key={c.id} className={cn("space-y-1.5 px-3 py-2", selected === c.id && "bg-muted/60", c.resolved && "opacity-50")} onClick={() => setSelected(c.id)}>
              <div className="flex items-center gap-2">
                <IconMessage className="size-3.5 text-muted-foreground" />
                <span className="truncate text-muted-foreground" lang={c.side === "source" ? "en" : "ko"}>“{c.quote}”</span>
                <Button size="icon-xs" variant="ghost" className="ml-auto" aria-label={c.resolved ? "Reopen" : "Resolve"}
                  onClick={(e) => { e.stopPropagation(); setComments((cs) => cs.map((x) => (x.id === c.id ? { ...x, resolved: !x.resolved } : x))) }}>
                  <IconCheck className={cn(c.resolved && "text-mark-term")} />
                </Button>
              </div>
              <p className={cn(c.resolved && "line-through")}>{c.body}</p>
              {c.replies.map((r, i) => <p key={i} className="border-l-2 pl-2 text-muted-foreground">{r.body}</p>)}
              {selected === c.id && !c.resolved && <Textarea placeholder="Reply…" className="min-h-8 text-xs" rows={1} />}
            </li>
          ))}
          {notes.map((n, i) => (
            <li key={"n" + n.id} className="space-y-1 px-3 py-2">
              <div className="flex items-center gap-2">
                <sup className="rounded-sm bg-mark-note px-0.5 text-[11px] font-medium">{i + 1}{n.kind === "translator" && <span className="opacity-60">T</span>}</sup>
                <span className="text-muted-foreground">{n.kind === "author" ? "Author's note" : "Translator's note"}</span>
                <span className="ml-auto truncate text-muted-foreground" lang="ko">“{n.quote}”</span>
              </div>
              {n.kind === "translator" ? <Textarea defaultValue={n.body} className="min-h-8 text-xs" rows={2} lang="ko" /> : <p className="text-muted-foreground" lang="en">{n.body}</p>}
            </li>
          ))}
        </ul>
      </aside>
    </div>
  )
}
