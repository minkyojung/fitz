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
              "bg-transparent text-inherit underline underline-offset-4 decoration-2",
              agreed ? "decoration-mark-term" : "decoration-dotted decoration-muted-foreground/50",
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
