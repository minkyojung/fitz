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
          <p className="p-3 text-xs text-muted-foreground">All notes are linked to the text.</p>
        ) : (
          <ul className="divide-y">
            {notes.map((n) => (
              <li key={n.id} className="space-y-1 px-3 py-2 text-xs">
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground tabular-nums">{n.origPage ? `p. ${n.origPage}` : "No page"}</span>
                  <Button size="xs" variant="outline" className="ml-auto" onClick={() => setLinking(n)}>
                    Link
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
        title="Choose a paragraph for this note"
        description="Searches paragraphs in the current chapter"
      >
        <Command>
        <CommandInput placeholder={linking?.origQuote ? `Paragraph containing “${linking.origQuote}”…` : "Search paragraphs…"} />
        <CommandList>
          <CommandEmpty>No matching paragraph.</CommandEmpty>
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
