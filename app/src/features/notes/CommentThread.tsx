import { useState } from "react"
import { IconCheck, IconMessage, IconTrash } from "@tabler/icons-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import type { Comment } from "@/data/api"
import { cn } from "cn"
import { useAnnotations } from "./AnnotationsContext"

/** A comment and its replies: reply, resolve (or reopen), delete. Opened from its mark in the text, or in the list of
 *  the chapter's comments (the status bar's Notes), where a comment on the whole paragraph, with no words to mark, is
 *  found. `onShow` takes you to its words. */
export function CommentThread({ root, onShow }: { root: Comment; onShow?: () => void }) {
  const ann = useAnnotations()!
  const replies = ann.annotations.comments.filter((r) => r.parentId === root.id)
  const [reply, setReply] = useState("")
  const quote = root.anchor
    ? <span className="truncate" lang={root.side === "source" ? "en" : "ko"}>“{root.anchor.exact}”</span>
    : <span>Whole paragraph</span>
  return (
    <div data-thread={root.id} className={cn("space-y-1.5 text-xs", root.resolved && "opacity-60")}>
      <div className="flex items-center gap-2">
        <IconMessage className="size-3.5 shrink-0 text-muted-foreground" />
        {onShow && root.anchor ? (
          <button type="button" className="min-w-0 truncate text-left text-muted-foreground hover:text-foreground hover:underline" onClick={onShow} title="Show in the text">
            {quote}
          </button>
        ) : (
          <span className="min-w-0 truncate text-muted-foreground">{quote}</span>
        )}
        {root.author === "agent" && <Badge variant="secondary" data-author="agent">Claude</Badge>}
        <span className="ml-auto flex shrink-0">
          <Button size="icon-xs" variant="ghost" aria-label={root.resolved ? "Reopen" : "Resolve"}
            onClick={() => void ann.actions.setComment(root.id, { resolved: !root.resolved })}>
            <IconCheck className={cn(root.resolved && "text-mark-term-ink")} />
          </Button>
          <Button size="icon-xs" variant="ghost" aria-label="Delete comment" onClick={() => void ann.actions.deleteComment(root.id)}>
            <IconTrash />
          </Button>
        </span>
      </div>
      <p className={cn("text-[13px] leading-relaxed", root.resolved && "line-through")}>{root.body}</p>
      {replies.map((r) => (
        <p key={r.id} className="border-l-2 pl-2 text-[13px] leading-relaxed text-muted-foreground">
          {r.author === "agent" && <Badge variant="secondary" data-author="agent" className="mr-1">Claude</Badge>}
          {r.body}
        </p>
      ))}
      {!root.resolved && (
        <Textarea value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Reply…" aria-label="Reply" rows={1} className="min-h-8 text-xs"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && reply.trim()) {
              e.preventDefault()
              void ann.actions.addComment(root.segmentId, root.side, null, reply.trim(), root.id)
              setReply("")
            }
          }} />
      )}
    </div>
  )
}
