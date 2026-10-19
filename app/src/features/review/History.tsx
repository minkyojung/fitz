import { useEffect, useState } from "react"
import { IconChevronRight, IconHistory } from "@tabler/icons-react"

import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { api } from "@/data/http"
import { OP_LABEL } from "@/data/useBook"
import type { OpRecord, Segment } from "@/data/api"
import { DiffView } from "./DiffView"

const time = (iso: string) => {
  const d = new Date(iso.replace(" ", "T") + "Z")
  return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })
}

/** The selected paragraph's history, from a button on it (Review's row, Translate's pair). */
export function HistoryButton({ segment }: { segment: Segment }) {
  return (
    <Popover>
      <PopoverTrigger render={<Button variant="ghost" size="icon-xs" aria-label="History" title="History" />} onClick={(e) => e.stopPropagation()}>
        <IconHistory />
      </PopoverTrigger>
      <PopoverContent side="bottom" align="end" className="max-h-[min(28rem,var(--available-height))] w-96 gap-0 overflow-y-auto p-0"
        onClick={(e) => e.stopPropagation()}>
        <History segment={segment} />
      </PopoverContent>
    </Popover>
  )
}

/** Cumulative diff against the OCR original, then the command log for this segment, each text edit expandable. The
 *  segment is a new object after any write to it, so the log is fetched again. */
function History({ segment }: { segment: Segment }) {
  const [ops, setOps] = useState<OpRecord[]>([])
  useEffect(() => {
    let live = true
    void api.listOps(segment.id).then((o) => live && setOps(o))
    return () => { live = false }
  }, [segment])

  return (
    <>
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
    </>
  )
}
