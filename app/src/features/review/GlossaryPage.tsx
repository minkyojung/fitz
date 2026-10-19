import { useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import type { GlossaryTerm } from "@/data/api"
import { useSpell } from "./SpellContext"

const KINDS: GlossaryTerm["kind"][] = ["person", "place", "org", "work", "other"]

interface Props {
  onJump: (segmentId: number, chapterId: number) => void
}

/** The book's glossary as a page: a table to go through, untranslated first, narrowed by a filter or to the terms
 *  without a translation. Translation and aliases are edited in place; blur saves. */
export function GlossaryPage({ onJump }: Props) {
  const spell = useSpell()
  const [filter, setFilter] = useState("")
  const [onlyPending, setOnlyPending] = useState(false)
  const all = spell?.glossary ?? []
  const pending = all.filter((t) => !t.translation).length
  const needle = filter.trim().toLowerCase()
  const terms = all
    .filter((t) => (!onlyPending || !t.translation) && (!needle || `${t.term} ${t.translation} ${t.aliases}`.toLowerCase().includes(needle)))
    .sort((a, b) => Number(!!a.translation) - Number(!!b.translation) || a.term.localeCompare(b.term))

  return (
    <div className="flex min-h-full flex-col">
      <div className="sticky top-0 z-10 flex items-center gap-2 border-b bg-background px-4 py-2">
        <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter terms" aria-label="Filter terms" className="h-8 w-64" />
        <Button size="sm" variant={onlyPending ? "secondary" : "outline"} aria-pressed={onlyPending} onClick={() => setOnlyPending(!onlyPending)}>
          Without translation <Badge variant="secondary" data-pending-terms>{pending}</Badge>
        </Button>
        <span className="ml-auto text-xs text-muted-foreground tabular-nums">{all.length} terms</span>
      </div>
      {all.length === 0 ? (
        <p className="p-4 text-xs text-muted-foreground">No terms yet. Add words from the spelling popover or select text in the source.</p>
      ) : (
        <div className="px-4">
          <Table aria-label="Glossary">
            <TableHeader>
              <TableRow>
                <TableHead className="w-56">Term</TableHead>
                <TableHead className="w-28">Kind</TableHead>
                <TableHead>Translation</TableHead>
                <TableHead>Aliases</TableHead>
                <TableHead className="w-24 text-right">Mentions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {/* keyed by what is saved: a change made elsewhere (⌘Z, a mark in the text) starts the row afresh */}
              {terms.map((t) => <TermRow key={`${t.id}:${t.translation}:${t.aliases}`} term={t} onJump={onJump} onSave={(input) => void spell?.setTerm(input)} />)}
            </TableBody>
          </Table>
        </div>
      )}
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
  const enter = (e: React.KeyboardEvent<HTMLInputElement>) => { if (e.key === "Enter") e.currentTarget.blur() }
  const cell = "h-8 border-transparent bg-transparent shadow-none hover:border-input dark:bg-transparent"
  return (
    <TableRow data-glossary-term={t.term}>
      <TableCell>
        <button type="button" className="reading text-[14px] font-medium hover:underline disabled:no-underline" lang="en"
          disabled={!t.first} onClick={() => t.first && onJump(t.first.segmentId, t.first.chapterId)} title="Jump to first mention">
          {t.term}
        </button>
      </TableCell>
      <TableCell>
        <Select value={t.kind} onValueChange={(v) => v && save({ kind: v as GlossaryTerm["kind"] })}>
          <SelectTrigger size="sm" aria-label={`Kind of ${t.term}`} className="h-7 border-transparent px-1 text-muted-foreground"><SelectValue>{t.kind}</SelectValue></SelectTrigger>
          <SelectContent>{KINDS.map((k) => <SelectItem key={k} value={k}>{k}</SelectItem>)}</SelectContent>
        </Select>
      </TableCell>
      <TableCell>
        <Input lang="ko" value={translation} placeholder="Translation" aria-label={`Translation of ${t.term}`} className={cell}
          onChange={(e) => setTranslation(e.target.value)} onBlur={() => save()} onKeyDown={enter} />
      </TableCell>
      <TableCell>
        <Input lang="ko" value={aliases} placeholder="Aliases, comma-separated" aria-label={`Aliases of ${t.term}`} className={cell}
          onChange={(e) => setAliases(e.target.value)} onBlur={() => save()} onKeyDown={enter} />
      </TableCell>
      <TableCell className="text-right text-muted-foreground tabular-nums">{t.occurrences}</TableCell>
    </TableRow>
  )
}
