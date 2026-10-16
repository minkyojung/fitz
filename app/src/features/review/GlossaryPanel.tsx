import { useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { GlossaryTerm } from "@/data/api"
import { useSpell } from "./SpellContext"

const KINDS: GlossaryTerm["kind"][] = ["person", "place", "org", "work", "other"]

interface Props {
  onJump: (segmentId: number, chapterId: number) => void
}

/** Every term of the book, untranslated first. Translation and aliases are edited inline; blur saves. */
export function GlossaryPanel({ onJump }: Props) {
  const spell = useSpell()
  const terms = [...(spell?.glossary ?? [])].sort((a, b) => Number(!!a.translation) - Number(!!b.translation) || a.term.localeCompare(b.term))
  const pending = terms.filter((t) => !t.translation).length

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-8 shrink-0 items-center gap-2 border-b px-3 text-xs">
        <span className="tabular-nums">{terms.length} terms</span>
        {pending > 0 && <Badge variant="secondary">{pending} without translation</Badge>}
      </div>
      <ScrollArea className="min-h-0 flex-1">
        {terms.length === 0 ? (
          <p className="p-3 text-xs text-muted-foreground">No terms yet. Add words from the spelling popover or select text in the source.</p>
        ) : (
          <ul className="divide-y">
            {terms.map((t) => <TermRow key={t.id} term={t} onJump={onJump} onSave={(input) => void spell?.setTerm(input)} />)}
          </ul>
        )}
      </ScrollArea>
    </div>
  )
}

function TermRow({ term: t, onJump, onSave }: {
  term: GlossaryTerm
  onJump: Props["onJump"]
  onSave: (input: { term: string; translation: string; aliases: string; kind: GlossaryTerm["kind"] }) => void
}) {
  const [translation, setTranslation] = useState(t.translation)
  const [aliases, setAliases] = useState(t.aliases)
  const save = (patch: Partial<{ translation: string; aliases: string; kind: GlossaryTerm["kind"] }> = {}) => {
    const next = { term: t.term, translation, aliases, kind: t.kind, ...patch }
    if (next.translation !== t.translation || next.aliases !== t.aliases || next.kind !== t.kind) onSave(next)
  }
  return (
    <li className="space-y-1 px-3 py-2 text-xs" data-glossary-term={t.term}>
      <div className="flex items-center gap-2">
        <button type="button" className="reading truncate text-[13px] font-medium hover:underline" lang="en"
          disabled={!t.first} onClick={() => t.first && onJump(t.first.segmentId, t.first.chapterId)} title="Jump to first mention">
          {t.term}
        </button>
        <span className="ml-auto shrink-0 text-muted-foreground tabular-nums">{t.occurrences}×</span>
        <Select value={t.kind} onValueChange={(v) => v && save({ kind: v as GlossaryTerm["kind"] })}>
          <SelectTrigger size="sm" aria-label="Kind" className="h-6 border-transparent px-1 text-muted-foreground"><SelectValue>{t.kind}</SelectValue></SelectTrigger>
          <SelectContent>{KINDS.map((k) => <SelectItem key={k} value={k}>{k}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <Input lang="ko" value={translation} placeholder="Translation" aria-label={`Translation of ${t.term}`}
        onChange={(e) => setTranslation(e.target.value)} onBlur={() => save()} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} />
      <Input lang="ko" value={aliases} placeholder="Aliases, comma-separated" aria-label={`Aliases of ${t.term}`}
        onChange={(e) => setAliases(e.target.value)} onBlur={() => save()} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} />
    </li>
  )
}
