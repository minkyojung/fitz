import { useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import type { GlossaryEntry } from "@/lib/glossary"
import { cn } from "cn"
import { useSpell } from "./SpellContext"

interface Props {
  entry: GlossaryEntry
  /** The source is read-only here (Translate): a click opens the term. In Review a click edits the text, as on any word. */
  editable?: boolean
  children: React.ReactNode
}

/** A glossary term in the source: green underline when its translation is agreed, dotted grey when not yet. Hover shows
 *  the translation. */
export function GlossaryMark({ entry, editable = false, children }: Props) {
  const agreed = entry.translation.trim().length > 0
  const mark = (
    <mark
      data-term={entry.term}
      className={cn(
        "border-b-2 bg-transparent text-inherit box-decoration-clone transition-colors",
        editable && "cursor-pointer",
        agreed ? "border-mark-term hover:bg-mark-term/40" : "border-dotted border-muted-foreground/40 hover:bg-muted",
      )}
    />
  )
  const tip = (
    <TooltipContent side="top">
      {agreed ? <span>{entry.term} → <b>{entry.translation}</b>{entry.aliases && <span className="opacity-70"> · {entry.aliases}</span>}</span> : `${entry.term} · no translation yet`}
    </TooltipContent>
  )
  if (!editable) return <Tooltip><TooltipTrigger render={mark}>{children}</TooltipTrigger>{tip}</Tooltip>
  return <EditableTerm entry={entry} mark={mark} tip={tip}>{children}</EditableTerm>
}

/** The term opened to set its translation and aliases there, without leaving the text. Closing saves. */
function EditableTerm({ entry, mark, tip, children }: { entry: GlossaryEntry; mark: React.ReactElement; tip: React.ReactNode; children: React.ReactNode }) {
  const spell = useSpell()
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState({ translation: entry.translation, aliases: entry.aliases })
  const openChange = (next: boolean) => {
    if (next) setDraft({ translation: entry.translation, aliases: entry.aliases })
    else if (draft.translation !== entry.translation || draft.aliases !== entry.aliases) {
      void spell?.setTerm({ term: entry.term, translation: draft.translation, aliases: draft.aliases, kind: entry.kind })
    }
    setOpen(next)
  }
  const enter = (e: React.KeyboardEvent<HTMLInputElement>) => { if (e.key === "Enter") openChange(false) }
  return (
    <Popover open={open} onOpenChange={openChange}>
      <Tooltip>
        <TooltipTrigger render={<PopoverTrigger nativeButton={false} onClick={(e) => e.stopPropagation()} render={mark} />}>{children}</TooltipTrigger>
        {tip}
      </Tooltip>
      <PopoverContent side="bottom" align="start" className="w-64 gap-2 text-xs">
        <div className="flex items-center gap-2">
          <span className="reading truncate text-[13px] font-medium" lang="en">{entry.term}</span>
          <Badge variant="outline">{entry.kind}</Badge>
          {entry.occurrences !== undefined && <span className="ml-auto shrink-0 text-muted-foreground tabular-nums">{entry.occurrences}×</span>}
        </div>
        <Input lang="ko" value={draft.translation} placeholder="Translation" aria-label={`Translation of ${entry.term}`}
          onChange={(e) => setDraft((d) => ({ ...d, translation: e.target.value }))} onKeyDown={enter} />
        <Input lang="ko" value={draft.aliases} placeholder="Aliases, comma-separated" aria-label={`Aliases of ${entry.term}`}
          onChange={(e) => setDraft((d) => ({ ...d, aliases: e.target.value }))} onKeyDown={enter} />
      </PopoverContent>
    </Popover>
  )
}
