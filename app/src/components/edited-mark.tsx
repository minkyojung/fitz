import { Fragment } from "react"

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { diffWords } from "@/lib/diff-text"

const MARKED = { del: "bg-destructive/10 text-destructive", ins: "bg-primary/10 no-underline" } as const

/** A dot on a paragraph whose source was changed since the OCR; it opens what was changed, word by word. */
export function EditedMark({ ocrText, sourceText }: { ocrText: string; sourceText: string }) {
  return (
    <Popover>
      <PopoverTrigger
        data-edited
        aria-label="Edited since the OCR: compare"
        title="Edited since the OCR"
        className="size-2 shrink-0 rounded-full bg-primary/70 outline-none hover:bg-primary focus-visible:ring-2 focus-visible:ring-ring"
      />
      <PopoverContent align="start" className="w-[min(36rem,90vw)]">
        <div className="mb-2 text-xs font-medium text-muted-foreground">Edited — compared with the OCR</div>
        <p data-diff lang="en" className="text-sm leading-relaxed whitespace-pre-wrap">
          {diffWords(ocrText, sourceText).map((part, i) => {
            if (part.kind === "same") return <span key={i}>{part.text}</span>
            // the words are marked, the space after them is not
            const words = part.text.trimEnd()
            const Mark = part.kind
            return (
              <Fragment key={i}>
                <Mark className={MARKED[part.kind]}>{words}</Mark>
                {part.text.slice(words.length)}
              </Fragment>
            )
          })}
        </p>
      </PopoverContent>
    </Popover>
  )
}
