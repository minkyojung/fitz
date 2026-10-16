import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import type { GlossaryEntry } from "@/lib/glossary"
import { cn } from "cn"

/** A glossary term in the source: green underline when its translation is agreed, dotted grey when not yet. */
export function GlossaryMark({ entry, children }: { entry: GlossaryEntry; children: React.ReactNode }) {
  const agreed = entry.translation.trim().length > 0
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <mark
            data-term={entry.term}
            className={cn(
              "border-b-2 bg-transparent text-inherit box-decoration-clone transition-colors",
              agreed ? "border-mark-term hover:bg-mark-term/40" : "border-dotted border-muted-foreground/40 hover:bg-muted",
            )}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent side="top">
        {agreed ? <span>{entry.term} → <b>{entry.translation}</b>{entry.aliases && <span className="opacity-70"> · {entry.aliases}</span>}</span> : `${entry.term} · no translation yet`}
      </TooltipContent>
    </Tooltip>
  )
}
