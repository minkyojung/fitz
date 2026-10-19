import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import type { Comment } from "@/data/api"
import { cn } from "cn"
import { CommentThread } from "./CommentThread"

/** A commented span: yellow wash with a matching bottom border; darker while hovered or selected. Selected, its thread
 *  opens beside it. */
export function CommentMark({ comment, selected, onSelect, children }: {
  comment: Comment; selected: boolean; onSelect: (selected: boolean) => void; children: React.ReactNode
}) {
  return (
    <Popover open={selected} onOpenChange={onSelect}>
      <PopoverTrigger
        nativeButton={false}
        onClick={(e) => e.stopPropagation()}
        render={
          <mark
            data-comment={comment.id}
            className={cn(
              "cursor-pointer border-b-2 border-mark-comment bg-mark-comment/40 text-inherit box-decoration-clone transition-colors hover:bg-mark-comment/70",
              selected && "bg-mark-comment/70",
            )}
          />
        }
      >
        {children}
      </PopoverTrigger>
      {/* clicks in the thread are not clicks on the paragraph (which would select it or start editing) */}
      <PopoverContent side="bottom" align="start" className="w-80" onClick={(e) => e.stopPropagation()}>
        <CommentThread root={comment} />
      </PopoverContent>
    </Popover>
  )
}

/** A footnote marker after its quote: number for an author's note, asterisk for a translator's.
 *  A provisional one (author's note not placed yet) is grey and sits at the paragraph's end. */
export function FootnoteMark({ id, label, body, lang, selected, onSelect, provisional = false }: {
  id: number; label: string; body: string; lang: "en" | "ko"; selected: boolean; onSelect: () => void; provisional?: boolean
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <sup
            data-note={id}
            data-provisional={provisional || undefined}
            onClick={(e) => { e.stopPropagation(); onSelect() }}
            className={cn(
              "ml-px cursor-pointer border-b-2 px-0.5 text-[11px] font-medium transition-colors",
              provisional
                ? cn("border-dashed border-muted-foreground/50 bg-muted text-muted-foreground hover:bg-muted-foreground/20", selected && "bg-muted-foreground/20")
                : cn("border-mark-note bg-mark-note/40 text-mark-note-ink hover:bg-mark-note/70", selected && "bg-mark-note/70"),
            )}
          />
        }
      >
        {label}
      </TooltipTrigger>
      {body && (
        <TooltipContent side="top" className="max-w-xs px-2.5 py-1.5 text-[13px] leading-normal">
          {provisional && <div className="mb-0.5 text-[11px] opacity-70">Not placed yet — select the words in the translation, then “Place note”</div>}
          <span className="reading text-[13px] leading-normal" lang={lang}>{body}</span>
        </TooltipContent>
      )}
    </Tooltip>
  )
}
