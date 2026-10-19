import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Command, CommandDialog, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import type { Note, Segment } from "@/data/api"
import { useAnnotations } from "./AnnotationsContext"
import { CommentThread } from "./CommentThread"

interface Props {
  /** The chapter's paragraphs: the comments' order, and where a note can be linked. */
  segments: Segment[]
  /** The book's author notes the pipeline could not place. */
  unlinked: Note[]
  onAnchor: (noteId: number, segmentId: number) => Promise<unknown>
  /** Translations are shown: the comments on them are in the text, and author notes' translations count. */
  translating: boolean
}

/** The status bar's Notes: how many comments are open, and what the stage asks of the author notes, untranslated in
 *  Translate, unplaced in Review; opened, the chapter's comments (those on a whole paragraph only here) and the
 *  unplaced notes, each linked from a picker. */
export function NotesButton({ segments, unlinked, onAnchor, translating }: Props) {
  const ann = useAnnotations()
  const [open, setOpen] = useState(false)
  // the picker is a dialog of its own: a click in it would be a click outside the list, closing it
  const [linking, setLinking] = useState<Note | null>(null)
  if (!ann) return null
  const order = new Map(segments.map((s, i) => [s.id, i]))
  const roots = ann.annotations.comments
    .filter((c) => c.parentId === null)
    .sort((a, b) => Number(a.resolved) - Number(b.resolved) || (order.get(a.segmentId) ?? 0) - (order.get(b.segmentId) ?? 0))
  const openCount = roots.filter((c) => !c.resolved).length
  const untranslated = ann.annotations.notes.filter((n) => n.kind === "author" && !n.bodyTarget.trim()).length
  /** Its words are in the text shown (Review shows the source only): select it there, its thread opens beside them. */
  const show = (id: number) => {
    setOpen(false)
    ann.select({ kind: "comment", id })
    requestAnimationFrame(() => document.querySelector(`mark[data-comment="${id}"]`)?.scrollIntoView({ block: "center" }))
  }

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger render={<button type="button" className="flex items-center gap-1.5 hover:text-foreground" />}>
          Notes
          <span aria-hidden>·</span><span data-open-comments>{openCount} open</span>
          <span aria-hidden>·</span>
          {translating ? <span data-untranslated-notes>{untranslated} untranslated</span> : <span data-unlinked-notes>{unlinked.length} unlinked</span>}
        </PopoverTrigger>
        <PopoverContent side="top" align="start" className="max-h-[min(32rem,var(--available-height))] w-96 gap-0 overflow-y-auto p-0">
          <section aria-label="Comments in this chapter">
            <h3 className="border-b px-3 py-2 text-xs font-medium">Comments in this chapter</h3>
            {roots.length === 0 ? (
              <p className="px-3 py-2 text-xs text-muted-foreground">None. Select words in the text and choose Comment.</p>
            ) : (
              <ul className="divide-y">
                {roots.map((c) => (
                  <li key={c.id} className="px-3 py-2">
                    <CommentThread root={c} onShow={translating || c.side === "source" ? () => show(c.id) : undefined} />
                  </li>
                ))}
              </ul>
            )}
          </section>
          {translating && untranslated > 0 && (
            <p className="border-t px-3 py-2 text-xs text-muted-foreground">
              {untranslated} author's note{untranslated > 1 ? "s" : ""} in this chapter without a translation: exported in English until translated.
            </p>
          )}
          <section aria-label="Author's notes not placed">
            <h3 className="border-y px-3 py-2 text-xs font-medium">Author's notes not placed in the text</h3>
            {unlinked.length === 0 ? (
              <p className="px-3 py-2 text-xs text-muted-foreground">All notes are linked to the text.</p>
            ) : (
              <ul className="divide-y">
                {unlinked.map((n) => (
                  <li key={n.id} className="space-y-1 px-3 py-2 text-xs">
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground tabular-nums">{n.origPage ? `p. ${n.origPage}` : "No page"}</span>
                      <Button size="sm" variant="outline" className="ml-auto" onClick={() => { setOpen(false); setLinking(n) }}>Link</Button>
                    </div>
                    {n.origQuote && <p className="reading text-[13px] font-medium" lang="en">“{n.origQuote}”</p>}
                    <p className="reading text-[13px] text-muted-foreground" lang="en">{n.bodySource}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </PopoverContent>
      </Popover>

      <CommandDialog open={linking !== null} onOpenChange={(o) => !o && setLinking(null)}
        title="Choose a paragraph for this note" description="Searches paragraphs in the current chapter">
        <Command>
          <CommandInput placeholder={linking?.origQuote ? `Paragraph containing “${linking.origQuote}”…` : "Search paragraphs…"} />
          <CommandList>
            <CommandEmpty>No matching paragraph.</CommandEmpty>
            {segments.map((s) => (
              <CommandItem key={s.id} value={`${s.id} ${s.sourceText}`}
                onSelect={() => { if (linking) void onAnchor(linking.id, s.id); setLinking(null) }}>
                <span className="w-10 shrink-0 text-muted-foreground tabular-nums">p.{s.pageStart}</span>
                <span className="truncate">{s.sourceText}</span>
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </CommandDialog>
    </>
  )
}
