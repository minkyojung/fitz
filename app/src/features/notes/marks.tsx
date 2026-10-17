import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "cn"

/** A commented span: yellow wash with a matching bottom border; darker while hovered or selected. */
export function CommentMark({ id, selected, onSelect, children }: { id: number; selected: boolean; onSelect: () => void; children: React.ReactNode }) {
  return (
    <mark
      data-comment={id}
      onClick={(e) => { e.stopPropagation(); onSelect() }}
      className={cn(
        "cursor-pointer border-b-2 border-mark-comment bg-mark-comment/40 text-inherit box-decoration-clone transition-colors hover:bg-mark-comment/70",
        selected && "bg-mark-comment/70",
      )}
    >
      {children}
    </mark>
  )
}

/** A footnote marker after its quote: number for an author's note, asterisk for a translator's. */
export function FootnoteMark({ id, label, body, lang, selected, onSelect }: {
  id: number; label: string; body: string; lang: "en" | "ko"; selected: boolean; onSelect: () => void
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <sup
            data-note={id}
            onClick={(e) => { e.stopPropagation(); onSelect() }}
            className={cn(
              "ml-px cursor-pointer border-b-2 border-mark-note bg-mark-note/40 px-0.5 text-[11px] font-medium text-mark-note-ink transition-colors hover:bg-mark-note/70",
              selected && "bg-mark-note/70",
            )}
          />
        }
      >
        {label}
      </TooltipTrigger>
      {body && (
        <TooltipContent side="top" className="max-w-xs px-2.5 py-1.5 text-[13px] leading-normal">
          <span className="reading text-[13px] leading-normal" lang={lang}>{body}</span>
        </TooltipContent>
      )}
    </Tooltip>
  )
}
