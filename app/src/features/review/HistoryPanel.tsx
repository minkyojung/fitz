import { useEffect, useState } from "react"
import { IconChevronRight } from "@tabler/icons-react"

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { ScrollArea } from "@/components/ui/scroll-area"
import { api } from "@/data/http"
import { OP_LABEL } from "@/data/useBook"
import type { OpRecord, Segment } from "@/data/api"
import { DiffView } from "./DiffView"

interface Props {
  segment: Segment | null
  /** Changes whenever a write completed, so the list refetches. */
  refreshKey: unknown
}

const time = (iso: string) => {
  const d = new Date(iso.replace(" ", "T") + "Z")
  return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })
}

/** Cumulative diff against the OCR original, then the command log for this segment, each text edit expandable. */
export function HistoryPanel({ segment, refreshKey }: Props) {
  const [ops, setOps] = useState<OpRecord[]>([])
  useEffect(() => {
    if (!segment) return
    let live = true
    void api.listOps(segment.id).then((o) => live && setOps(o))
    return () => { live = false }
  }, [segment, refreshKey])

  if (!segment) return <p className="p-3 text-xs text-muted-foreground">Select a paragraph.</p>
  return (
    <ScrollArea className="h-full">
      <div className="border-b px-3 py-2">
        <div className="mb-1 text-xs font-medium">Now vs. original</div>
        {segment.ocrText === null ? (
          <p className="text-xs text-muted-foreground">No original (edited before originals were kept)</p>
        ) : (
          <DiffView before={segment.ocrText} after={segment.sourceText} />
        )}
      </div>
      {ops.length === 0 ? (
        <p className="p-3 text-xs text-muted-foreground">No history</p>
      ) : (
        <ul className="divide-y text-xs" aria-label="History of this paragraph">
          {ops.map((o) => (
            <li key={o.id} className={o.undone ? "text-muted-foreground" : ""}>
              {o.before !== null && o.after !== null ? (
                <Collapsible>
                  <CollapsibleTrigger className="group flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted/50">
                    <IconChevronRight className="size-3 transition-transform group-data-[panel-open]:rotate-90" />
                    <span className="tabular-nums">{time(o.createdAt)}</span>
                    <span className={o.undone ? "line-through" : ""}>{OP_LABEL[o.name] ?? o.name}</span>
                    {o.undone && <span className="ml-auto">Undone</span>}
                  </CollapsibleTrigger>
                  <CollapsibleContent className="px-3 pb-2 pl-8">
                    <DiffView before={o.before} after={o.after} />
                  </CollapsibleContent>
                </Collapsible>
              ) : (
                <div className="flex gap-2 px-3 py-2 pl-8">
                  <span className="tabular-nums">{time(o.createdAt)}</span>
                  <span className={o.undone ? "line-through" : ""}>{OP_LABEL[o.name] ?? o.name}</span>
                  {o.undone && <span className="ml-auto">Undone</span>}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </ScrollArea>
  )
}
