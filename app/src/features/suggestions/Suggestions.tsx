import { useEffect, useState } from "react"
import { IconCheck, IconMessage, IconSparkles, IconX } from "@tabler/icons-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import type { Segment, Suggestion, SuggestionDecision, TaskName, TaskRun } from "@/data/api"
import { findOnce } from "@/lib/suggestions"
import { cn } from "cn"
import { useSuggestions } from "./SuggestionsContext"

const TASK: Record<TaskName, { start: string; label: string; found: (n: number) => string; comment: boolean }> = {
  review: { start: "Review this chapter with Claude", label: "Claude", found: (n) => `${n} suggestion${n === 1 ? "" : "s"}`, comment: true },
  typos: { start: "Find OCR errors with Claude", label: "Claude · OCR", found: (n) => `${n} likely OCR error${n === 1 ? "" : "s"} · check them against the scan`, comment: false },
}

interface Props {
  task: TaskName
  segments: Segment[]
  run: TaskRun | undefined
  onRun: () => void
  onDecide: (s: Suggestion, decision: SuggestionDecision) => Promise<unknown>
}

/** Claude's suggestions on the chapter (docs/agent.md §4.1), under the Claude tab's head: one line to start the task
 *  and see it go, then a card for each. The text only points at them; each is decided with its card's buttons. */
export function Suggestions({ task, segments, run, onRun, onDecide }: Props) {
  const ctx = useSuggestions()
  if (!ctx) return null
  const t = TASK[task]
  const open = ctx.suggestions
  return (
    <div>
      <div data-run={run?.state ?? "idle"} className="flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2 text-xs">
        {run?.state === "running" ? (
          <span className="text-muted-foreground"><IconSparkles className="mr-1 inline size-3.5 animate-pulse" />Claude is reading the chapter…</span>
        ) : (
          <>
            <Button size="sm" variant="outline" onClick={onRun}><IconSparkles data-icon="inline-start" />{t.start}</Button>
            {run?.state === "done" && <span className="text-muted-foreground">{open.length ? t.found(open.length) : "No open suggestions"}</span>}
            {run?.state === "failed" && <span className="text-destructive">{run.message}</span>}
          </>
        )}
      </div>
      <ul aria-label="Claude's suggestions">
        {open.map((s) => {
          const at = segments.findIndex((x) => x.id === s.segmentId)
          const seg = segments[at]
          const text = seg ? (s.side === "source" ? seg.sourceText : seg.targetText) : ""
          return (
            <Card key={s.id} s={s} label={t.label} number={at + 1} stale={findOnce(text, s.quote) === -1} comment={t.comment}
              selected={ctx.selected === s.id} onPick={() => ctx.select(s.id)} onDecide={(d) => onDecide(s, d)} />
          )
        })}
      </ul>
    </div>
  )
}

function Card({ s, label, number, stale, comment, selected, onPick, onDecide }: {
  s: Suggestion; label: string; number: number; stale: boolean; comment: boolean; selected: boolean
  onPick: () => void; onDecide: (decision: SuggestionDecision) => Promise<unknown>
}) {
  const [el, setEl] = useState<HTMLLIElement | null>(null)
  useEffect(() => { if (selected) el?.scrollIntoView({ block: "nearest" }) }, [selected, el])
  // one decision at a time: a second click while the first is on its way would only be refused
  const [busy, setBusy] = useState(false)
  const decide = (d: SuggestionDecision) => { setBusy(true); void onDecide(d).finally(() => setBusy(false)) }
  return (
    <li ref={setEl} data-panel-suggestion={s.id} data-selected={selected || undefined} onClick={onPick}
      className={cn("cursor-pointer space-y-1.5 border-b border-l-2 border-l-transparent px-3 py-2 text-sm/relaxed", selected && "border-l-ring bg-muted")}>
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {number > 0 && <span className="tabular-nums">¶{number}</span>}
        {s.level && <Badge variant={s.level === "high" ? "destructive" : "secondary"}>{s.level}</Badge>}
        <Badge variant="outline">{label}</Badge>
      </div>
      <p lang={s.side === "source" ? "en" : "ko"}>
        <span className="line-through decoration-destructive/60">{s.quote}</span> → <span className="text-mark-term-ink">{s.replacement}</span>
      </p>
      <p className="text-xs/relaxed text-muted-foreground" lang="ko">{s.why}</p>
      {stale && <p data-stale className="text-xs/relaxed text-mark-warning-ink">The paragraph changed since: these words are no longer there to replace.</p>}
      <div className="flex flex-wrap gap-1" onClick={(e) => e.stopPropagation()}>
        <Button size="sm" disabled={busy || stale} onClick={() => decide("accept")}><IconCheck data-icon="inline-start" />Accept</Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => decide("dismiss")}><IconX data-icon="inline-start" />Dismiss</Button>
        {comment && <Button size="sm" variant="ghost" disabled={busy} onClick={() => decide("comment")}><IconMessage data-icon="inline-start" />Keep as comment</Button>}
      </div>
    </li>
  )
}
