import { IconX } from "@tabler/icons-react"

import type { Pointed as PointedWords } from "@/lib/conversation"

/** What the translator pointed at: the paragraph and the words. */
export function Pointed({ pointed, onRemove }: { pointed: PointedWords; onRemove?: () => void }) {
  return (
    <span data-pointed className="inline-flex max-w-full items-center gap-1 rounded border bg-background px-1.5 py-0.5 text-xs text-foreground">
      <span className="shrink-0 text-muted-foreground">¶{pointed.segmentId}</span>
      <span className="truncate" lang={pointed.side === "source" ? "en" : "ko"}>“{pointed.quote}”</span>
      {onRemove && (
        <button type="button" aria-label="Remove" onClick={onRemove} className="text-muted-foreground hover:text-foreground">
          <IconX className="size-3" />
        </button>
      )}
    </span>
  )
}
