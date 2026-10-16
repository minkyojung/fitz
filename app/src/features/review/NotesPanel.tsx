import { useState } from "react"

import { Button } from "@/components/ui/button"
import {
  Command, CommandDialog, CommandEmpty, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command"
import { ScrollArea } from "@/components/ui/scroll-area"
import type { Note, Segment } from "@/data/api"

interface Props {
  notes: Note[]
  segments: Segment[]
  onAnchor: (noteId: number, segmentId: number) => Promise<unknown>
}

/** Author endnotes the pipeline could not place. Each is linked by picking a segment of the current chapter. */
export function NotesPanel({ notes, segments, onAnchor }: Props) {
  const [linking, setLinking] = useState<Note | null>(null)

  return (
    <div className="flex h-full flex-col">
      <ScrollArea className="min-h-0 flex-1">
        {notes.length === 0 ? (
          <p className="p-3 text-xs text-muted-foreground">모든 미주가 본문에 연결되었습니다.</p>
        ) : (
          <ul className="divide-y">
            {notes.map((n) => (
              <li key={n.id} className="space-y-1 px-3 py-2 text-xs">
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground tabular-nums">{n.origPage ? `p. ${n.origPage}` : "쪽 없음"}</span>
                  <Button size="xs" variant="outline" className="ml-auto" onClick={() => setLinking(n)}>
                    연결
                  </Button>
                </div>
                {n.origQuote && <p className="reading text-[13px] font-medium" lang="en">“{n.origQuote}”</p>}
                <p className="reading text-[13px] text-muted-foreground" lang="en">{n.bodySource}</p>
              </li>
            ))}
          </ul>
        )}
      </ScrollArea>

      <CommandDialog
        open={linking !== null}
        onOpenChange={(open) => !open && setLinking(null)}
        title="미주를 연결할 단락 선택"
        description="현재 장의 단락을 검색합니다"
      >
        <Command>
        <CommandInput placeholder={linking?.origQuote ? `“${linking.origQuote}” 가 있는 단락…` : "단락 검색…"} />
        <CommandList>
          <CommandEmpty>일치하는 단락이 없습니다.</CommandEmpty>
          {segments.map((s) => (
            <CommandItem
              key={s.id}
              value={`${s.id} ${s.sourceText}`}
              onSelect={() => {
                if (linking) void onAnchor(linking.id, s.id)
                setLinking(null)
              }}
            >
              <span className="w-10 shrink-0 text-muted-foreground tabular-nums">p.{s.pageStart}</span>
              <span className="truncate">{s.sourceText}</span>
            </CommandItem>
          ))}
        </CommandList>
        </Command>
      </CommandDialog>
    </div>
  )
}
