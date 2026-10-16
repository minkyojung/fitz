import { useMemo, useRef, useState } from "react"

import { Command, CommandGroup, CommandItem, CommandList, CommandSeparator } from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { rankCandidates } from "@/lib/rank"
import type { Suspect } from "@/lib/spell"
import { useSpell } from "./SpellContext"

/** A top candidate backed by evidence from this book (frequency or neighbour pairs) is offered inline;
 *  a bare dictionary look-alike with no evidence is not. */
const CONFIDENT = 1

export const SPELL_STRUCK_CLASS =
  "rounded-sm bg-mark-warning/60 px-0.5 text-destructive line-through decoration-destructive/60 cursor-pointer"
export const SPELL_MARK_CLASS =
  "rounded-sm bg-mark-warning/50 text-inherit underline decoration-destructive/70 decoration-dotted decoration-2 underline-offset-4 cursor-pointer"

interface Props {
  suspect: Suspect
  context: { prev?: string; next?: string }
  onAccept: (replacement: string) => void
}

/** A word the dictionary cannot form. Confident fixes show in the diff language (struck word, inserted
 *  replacement; click the insertion to accept). Clicking the word lists all candidates and "Add to dictionary". */
export function SpellMark({ suspect: s, context, onAccept }: Props) {
  const spell = useSpell()
  const [open, setOpen] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  // cheap pass for the inline fix (OCR confusions only); the full list waits for the popover
  const speller = spell?.speller ?? null
  const corpus = spell?.corpus
  const quick = useMemo(
    () => (speller && corpus ? rankCandidates(s.word, context, null, speller.correct, corpus) : []),
    [speller, corpus, s.word, context.prev, context.next], // eslint-disable-line react-hooks/exhaustive-deps
  )
  const ranked = useMemo(
    () => (open && speller && corpus ? rankCandidates(s.word, context, speller.suggest, speller.correct, corpus) : quick),
    [open, speller, corpus, s.word, context.prev, context.next, quick], // eslint-disable-line react-hooks/exhaustive-deps
  )
  const top = quick[0] && quick[0].score >= CONFIDENT ? quick[0].word : null

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<mark data-spell className={top ? SPELL_STRUCK_CLASS : SPELL_MARK_CLASS} />} onClick={(e) => e.stopPropagation()}>
        {s.word}
      </PopoverTrigger>
      {top && (
        <>
          {" "}
          <ins
            data-spell-fix
            role="button"
            tabIndex={0}
            className="cursor-pointer rounded-sm bg-mark-term px-0.5 no-underline hover:brightness-95"
            title="Click to accept this fix"
            onClick={(e) => { e.stopPropagation(); onAccept(top) }}
            onKeyDown={(e) => e.key === "Enter" && onAccept(top)}
          >
            {top}
          </ins>
        </>
      )}
      <PopoverContent side="bottom" align="start" className="w-52 p-0" initialFocus={listRef}>
        <Command ref={listRef} tabIndex={-1} className="outline-none">
          <CommandList>
            <CommandGroup heading={`“${s.word}”`}>
              {ranked.length ? (
                ranked.map((r) => (
                  <CommandItem key={r.word} value={r.word} onSelect={() => { onAccept(r.word); setOpen(false) }}>
                    {r.word}
                  </CommandItem>
                ))
              ) : (
                <div className="px-2 py-1.5 text-xs text-muted-foreground">No suggestions</div>
              )}
            </CommandGroup>
            <CommandSeparator />
            <CommandGroup>
              <CommandItem value="__add" onSelect={() => { void spell?.addWord(s.word); setOpen(false) }}>
                Add to dictionary
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
