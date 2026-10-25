import { useState } from "react"
import { IconChartPie } from "@tabler/icons-react"

import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Progress } from "@/components/ui/progress"
import { Separator } from "@/components/ui/separator"
import type { ContextUsage } from "@/data/api"
import type { Claude } from "@/data/useClaude"

/** The plan's windows as the card shows them: a share of the window used, and when it resets (ms). */
export type PlanWindows = Record<string, { utilization?: number; resetsAt?: number }> | null

const k = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1)}k` : String(n))
const pct = (part: number, whole: number) => `${((part / whole) * 100).toFixed(part / whole < 0.01 && part > 0 ? 1 : 0)}%`
const when = (ms: number) => new Date(ms).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
const WINDOW_NAME: Record<string, string> = { five_hour: "Current session", seven_day: "Current week (all models)", seven_day_opus: "Current week (Opus)", seven_day_sonnet: "Current week (Sonnet)" }

/** The Context window (docs/agent.md §32): how full the conversation is, by category; the plan's windows; Compact. */
export function ContextCard({ usage, windows, compacting, onCompact }: { usage: ContextUsage | null; windows: PlanWindows; compacting: boolean; onCompact?: () => void }) {
  return (
    <div className="w-72 text-xs" data-context>
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-semibold">Context</span>
        {usage && <span className="tabular-nums text-muted-foreground" data-context-total>{k(usage.totalTokens)} / {k(usage.maxTokens)}</span>}
      </div>
      {usage ? (
        <>
          <Progress value={(usage.totalTokens / usage.maxTokens) * 100} className="mt-2 h-1.5" />
          <dl className="mt-3 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1.5">
            {[...usage.categories.filter((c) => c.kind === "free"), ...usage.categories.filter((c) => c.kind !== "free")].map((c) => (
              <div key={c.name} className="contents">
                <dt className="text-muted-foreground">{c.name}</dt>
                <dd className="tabular-nums">{pct(c.tokens, usage.maxTokens)}</dd>
              </div>
            ))}
          </dl>
        </>
      ) : (
        <p className="mt-2 text-muted-foreground">Known from the next message on: no Claude Code is running this conversation.</p>
      )}
      {windows && Object.values(windows).some((w) => typeof w?.utilization === "number") && (
        <>
          <Separator className="my-3" />
          <div className="text-sm font-semibold">Plan usage</div>
          <dl className="mt-2 space-y-2">
            {Object.entries(windows).filter(([, w]) => typeof w?.utilization === "number").map(([key, w]) => (
              <div key={key}>
                <div className="flex items-baseline justify-between"><dt className="text-muted-foreground">{WINDOW_NAME[key] ?? key}</dt><dd className="tabular-nums">{Math.round((w.utilization ?? 0) * 100)}%</dd></div>
                <Progress value={(w.utilization ?? 0) * 100} className="mt-1 h-1" />
                {w.resetsAt && <div className="mt-0.5 text-muted-foreground">Resets {when(w.resetsAt)}</div>}
              </div>
            ))}
          </dl>
        </>
      )}
      <Button variant="outline" size="sm" className="mt-4 w-full" disabled={!usage || compacting} onClick={onCompact}>{compacting ? "Compacting…" : "Compact the conversation"}</Button>
    </div>
  )
}

/** The button on Claude's head row that opens the window; the usage is asked of the server as it opens. */
export function ContextPopover({ claude }: { claude: Claude }) {
  const [usage, setUsage] = useState<ContextUsage | null>(null)
  const [open, setOpen] = useState(false)
  const windows = claude.view.state.limits?.windows ?? null
  // the rate_limit_event's resetsAt is in seconds
  const shown: PlanWindows = windows && Object.fromEntries(Object.entries(windows).map(([key, w]) => [key, { ...w, resetsAt: w.resetsAt ? w.resetsAt * 1000 : undefined }]))
  const toggle = (next: boolean) => {
    setOpen(next)
    if (next) void claude.context().then(setUsage)
  }
  return (
    <Popover open={open} onOpenChange={toggle}>
      <PopoverTrigger render={<Button variant="ghost" size="icon-sm" className="shrink-0" aria-label="Context" title="How full this conversation is" disabled={!claude.convId} />}>
        <IconChartPie />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-auto p-4">
        <ContextCard usage={usage} windows={shown} compacting={claude.view.state.compacting} onCompact={() => { claude.compact(); setOpen(false) }} />
      </PopoverContent>
    </Popover>
  )
}
