import { useState } from "react"
import { IconChevronRight } from "@tabler/icons-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { GlossaryTerm } from "@/data/api"
import { useSpell } from "@/features/review/SpellContext"
import { cn } from "cn"

const KINDS: GlossaryTerm["kind"][] = ["person", "place", "org", "work", "other"]
/** The kind's dot, the colour its mark in the text has. */
const KIND_DOT: Record<GlossaryTerm["kind"], string> = { person: "bg-mark-term", place: "bg-mark-note", org: "bg-mark-comment", work: "bg-mark-italic", other: "bg-muted-foreground/40" }

interface Props {
  onJump: (segmentId: number, chapterId: number) => void
}

/** The book's glossary in the reference column (§35): a list to go through, untranslated first, narrowed by a filter or
 *  to the terms without a translation. A row opened edits its translation, aliases and kind in place; blur saves. */
export function GlossaryList({ onJump }: Props) {
  const spell = useSpell()
  const [filter, setFilter] = useState("")
  const [onlyPending, setOnlyPending] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  const all = spell?.glossary ?? []
  const pending = all.filter((t) => !t.translation).length
  const needle = filter.trim().toLowerCase()
  const terms = all
    .filter((t) => (!onlyPending || !t.translation) && (!needle || `${t.term} ${t.translation} ${t.aliases}`.toLowerCase().includes(needle)))
    .sort((a, b) => Number(!!a.translation) - Number(!!b.translation) || a.term.localeCompare(b.term))

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-1.5 border-b px-2 py-1.5">
        <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter terms" aria-label="Filter terms" className="h-7 min-w-0 flex-1 text-xs" />
        <Button size="xs" variant={onlyPending ? "secondary" : "outline"} aria-pressed={onlyPending} onClick={() => setOnlyPending(!onlyPending)}>
          Without translation <Badge variant="secondary" data-pending-terms>{pending}</Badge>
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {all.length === 0 ? (
          <p className="p-3 text-xs text-muted-foreground">No terms yet. Add words from the spelling popover or select text in the source.</p>
        ) : (
          <ul aria-label="Glossary" className="divide-y text-xs">
            {/* keyed by what is saved: a change made elsewhere (⌘Z, a mark in the text) starts the row afresh */}
            {terms.map((t) => (
              <TermItem key={`${t.id}:${t.translation}:${t.aliases}:${t.kind}`} term={t} open={open === t.term} onOpenChange={(o) => setOpen(o ? t.term : null)}
                onJump={onJump} onSave={(input) => void spell?.setTerm(input)} />
            ))}
          </ul>
        )}
        <p className="px-3 py-2 text-[11px] text-muted-foreground tabular-nums">{all.length} terms</p>
      </div>
    </div>
  )
}

function TermItem({ term: t, open, onOpenChange, onJump, onSave }: {
  term: GlossaryTerm
  open: boolean
  onOpenChange: (open: boolean) => void
  onJump: Props["onJump"]
  onSave: (input: { term: string; translation: string; aliases: string; kind: GlossaryTerm["kind"] }) => void
}) {
  const [translation, setTranslation] = useState(t.translation)
  const [aliases, setAliases] = useState(t.aliases)
  const save = (patch: Partial<{ translation: string; aliases: string; kind: GlossaryTerm["kind"] }> = {}) => {
    const next = { term: t.term, translation, aliases, kind: t.kind, ...patch }
    if (next.translation !== t.translation || next.aliases !== t.aliases || next.kind !== t.kind) onSave(next)
  }
  const enter = (e: React.KeyboardEvent<HTMLInputElement>) => { if (e.key === "Enter") e.currentTarget.blur() }
  return (
    <li data-glossary-term={t.term}>
      <button type="button" className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-muted/50" aria-expanded={open} aria-label={t.term} onClick={() => onOpenChange(!open)}>
        <span className={cn("size-2 shrink-0 rounded-full", KIND_DOT[t.kind])} title={t.kind} />
        <span className="reading min-w-0 flex-1 truncate text-[13px] font-medium" lang="en">{t.term}</span>
        {t.translation ? <span lang="ko" className="min-w-0 truncate text-muted-foreground">{t.translation}</span> : <span className="text-mark-warning-ink" title="No translation yet">—</span>}
        <span className="w-8 shrink-0 text-right text-muted-foreground tabular-nums">{t.occurrences}</span>
        <IconChevronRight className={cn("size-3 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")} />
      </button>
      {open && (
        <div className="space-y-2 bg-muted/30 px-3 pt-1 pb-3 pl-7">
          <Input lang="ko" value={translation} placeholder="Translation" aria-label={`Translation of ${t.term}`} className="h-7 text-xs"
            onChange={(e) => setTranslation(e.target.value)} onBlur={() => save()} onKeyDown={enter} />
          <Input lang="ko" value={aliases} placeholder="Aliases, comma-separated" aria-label={`Aliases of ${t.term}`} className="h-7 text-xs"
            onChange={(e) => setAliases(e.target.value)} onBlur={() => save()} onKeyDown={enter} />
          <div className="flex items-center gap-2">
            <Select value={t.kind} onValueChange={(v) => v && save({ kind: v as GlossaryTerm["kind"] })}>
              <SelectTrigger size="sm" aria-label={`Kind of ${t.term}`} className="h-7 w-28 text-xs"><SelectValue>{t.kind}</SelectValue></SelectTrigger>
              <SelectContent>{KINDS.map((k) => <SelectItem key={k} value={k}>{k}</SelectItem>)}</SelectContent>
            </Select>
            {t.first && <Button size="xs" variant="ghost" className="ml-auto" onClick={() => onJump(t.first!.segmentId, t.first!.chapterId)}>First mention</Button>}
          </div>
        </div>
      )}
    </li>
  )
}
