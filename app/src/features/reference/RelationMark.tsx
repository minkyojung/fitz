import { IconAffiliate } from "@tabler/icons-react"

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "cn"
import { useRelations } from "./RelationsContext"

/** How many relations rest on a paragraph, in its header; a click selects it and opens the Relations tab, where they light up. */
export function RelationMark({ segmentId, onSelect, className }: { segmentId: number; onSelect: () => void; className?: string }) {
  const rel = useRelations()
  const mine = rel?.relations.filter((r) => r.segmentId === segmentId) ?? []
  if (!rel || !mine.length) return null
  return (
    <Tooltip>
      <TooltipTrigger
        render={<button type="button" data-relations={mine.length} aria-label={`${mine.length} relation${mine.length > 1 ? "s" : ""} rest on this paragraph`} />}
        className={cn("flex items-center gap-0.5 rounded px-0.5 text-[11px] text-muted-foreground tabular-nums hover:bg-muted hover:text-foreground", className)}
        onClick={(e) => { e.stopPropagation(); onSelect(); rel.show() }}
      >
        <IconAffiliate className="size-3" />{mine.length}
      </TooltipTrigger>
      <TooltipContent side="right" lang="ko">
        {mine.map((r) => <div key={r.id}>{r.from} → {r.to}: {r.label}</div>)}
      </TooltipContent>
    </Tooltip>
  )
}
