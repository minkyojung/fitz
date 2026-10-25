import { useState } from "react"
import { IconChartPie } from "@tabler/icons-react"

import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Progress } from "@/components/ui/progress"
import { Separator } from "@/components/ui/separator"

/** ?gallery&context — the Context window of Claude's panel (docs/agent.md §32): how full the conversation is, by
 *  category, the plan's windows, and Compact. The numbers are what getContextUsage and the rate_limit_event answered
 *  on 2026-10-25 (Haiku), and a fuller conversation made up from them. */

type Usage = { totalTokens: number; maxTokens: number; categories: { name: string; tokens: number; kind: "used" | "free" | "buffer" }[] }
type Windows = Record<string, { utilization?: number; resetsAt?: number }> | null

const MEASURED: Usage = {
  totalTokens: 4769, maxTokens: 1_000_000,
  categories: [
    { name: "System prompt", tokens: 1787, kind: "used" }, { name: "System tools", tokens: 735, kind: "used" },
    { name: "MCP tools", tokens: 662, kind: "used" }, { name: "Messages", tokens: 1585, kind: "used" },
    { name: "Autocompact buffer", tokens: 33_000, kind: "buffer" }, { name: "Free space", tokens: 962_231, kind: "free" },
  ],
}
const FULLER: Usage = {
  totalTokens: 574_700, maxTokens: 1_000_000,
  categories: [
    { name: "System prompt", tokens: 1787, kind: "used" }, { name: "System tools", tokens: 735, kind: "used" },
    { name: "MCP tools", tokens: 662, kind: "used" }, { name: "Messages", tokens: 571_516, kind: "used" },
    { name: "Autocompact buffer", tokens: 33_000, kind: "buffer" }, { name: "Free space", tokens: 392_300, kind: "free" },
  ],
}
const WINDOWS: Windows = { five_hour: { utilization: 0.16, resetsAt: Date.now() + 2 * 3600_000 }, seven_day: { utilization: 0.25, resetsAt: Date.now() + 30 * 3600_000 } }

const k = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1)}k` : String(n))
const pct = (part: number, whole: number) => `${((part / whole) * 100).toFixed(part / whole < 0.01 && part > 0 ? 1 : 0)}%`
const when = (ms: number) => new Date(ms).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
const WINDOW_NAME: Record<string, string> = { five_hour: "Current session", seven_day: "Current week (all models)", seven_day_opus: "Current week (Opus)", seven_day_sonnet: "Current week (Sonnet)" }

function ContextCard({ usage, windows, compacting }: { usage: Usage | null; windows: Windows; compacting: boolean }) {
  return (
    <div className="w-72 text-xs">
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-semibold">Context</span>
        {usage && <span className="tabular-nums text-muted-foreground">{k(usage.totalTokens)} / {k(usage.maxTokens)}</span>}
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
      {windows && (
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
      <Button variant="outline" size="sm" className="mt-4 w-full" disabled={!usage || compacting}>{compacting ? "Compacting…" : "Compact the conversation"}</Button>
    </div>
  )
}

export function ContextGallery() {
  const [open, setOpen] = useState(true)
  return (
    <div className="min-h-svh bg-background p-8 text-foreground">
      <h1 className="text-lg font-semibold">Context 창</h1>
      <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
        Claude 패널 머리줄의 버튼이 여는 창. 막대와 분류는 <code>getContextUsage</code>(비용 0), Plan usage는 턴마다 오는 <code>rate_limit_event</code>의 창들.
        Octave의 창과 같은 항목, 이 앱의 글자 크기(12px)와 부품으로.
      </p>
      <div className="mt-6 flex flex-wrap items-start gap-10">
        <section>
          <h2 className="mb-2 text-sm font-medium">머리줄의 버튼과 열린 창(측정값 그대로: 짧은 대화)</h2>
          <div className="flex h-9 w-[233px] items-center justify-end rounded-md border px-2">
            <Popover open={open} onOpenChange={setOpen}>
              <PopoverTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Context" />}><IconChartPie /></PopoverTrigger>
              <PopoverContent align="end" className="w-auto p-4"><ContextCard usage={MEASURED} windows={WINDOWS} compacting={false} /></PopoverContent>
            </Popover>
          </div>
        </section>
        <section className="rounded-md border p-4"><h2 className="mb-3 text-sm font-medium">긴 대화(574.7k)</h2><ContextCard usage={FULLER} windows={WINDOWS} compacting={false} /></section>
        <section className="rounded-md border p-4"><h2 className="mb-3 text-sm font-medium">압축 중</h2><ContextCard usage={FULLER} windows={WINDOWS} compacting /></section>
        <section className="rounded-md border p-4"><h2 className="mb-3 text-sm font-medium">API 키로 쓸 때(요금제 창 없음) · 프로세스 없음</h2><ContextCard usage={null} windows={null} compacting={false} /></section>
      </div>
    </div>
  )
}
