import type { Doc, Segment } from "@shared/protocol.ts"

import { DocText } from "@/components/doc-text"
import { SegmentEditor, type Leave } from "@/components/segment-editor"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

const KIND_STYLE: Record<Segment["kind"], string> = {
  paragraph: "",
  heading: "text-base font-medium",
  blockquote: "border-l-2 pl-4",
  caption: "text-xs text-muted-foreground",
  verse: "whitespace-pre-wrap",
}
const STATUS_LABEL: Record<Segment["status"], string> = { untranslated: "Not translated", draft: "Draft", reviewed: "Reviewed", final: "Final" }
const STATUS_DOT: Record<Segment["status"], string> = { untranslated: "bg-border", draft: "bg-muted-foreground/50", reviewed: "bg-primary", final: "bg-primary" }

const EMPTY: Doc = { type: "doc", content: [{ type: "paragraph" }] }

/** Where in the document a click on its read view landed: the editor opens with the caret there. */
function caretAt(event: React.MouseEvent<HTMLElement>): number | "end" {
  const range = document.caretRangeFromPoint(event.clientX, event.clientY)
  const paragraphs = [...event.currentTarget.querySelectorAll("p")]
  const p = range ? paragraphs.findIndex((el) => el.contains(range.startContainer)) : -1
  if (!range || p === -1) return "end"
  const before = document.createRange()
  before.setStart(paragraphs[p]!, 0)
  before.setEnd(range.startContainer, range.startOffset)
  // a paragraph costs one position to open and one to close
  return paragraphs.slice(0, p).reduce((pos, el) => pos + (el.textContent?.length ?? 0) + 2, 1 + before.toString().length)
}

/** One paragraph: its source, its status, its translation — which a click opens for editing. */
export function SegmentRow({ segment, target, draft, editing, onEdit, onLeave, onCancel, onDraft, onDiscard }: {
  segment: Segment
  /** The translation to show: the one being saved until the save settles, else the paragraph's own. */
  target: Doc | null
  /** Text typed here and never saved, when there is some: it is said, and never dropped silently. */
  draft: { changedSince: boolean } | null
  /** Set while this paragraph is the one being edited: where the caret starts and the text the edit opens on. */
  editing: { caret: number | "end"; doc: Doc | null } | null
  onEdit: (caret: number | "end") => void
  onLeave: (doc: Doc, how: Leave) => void
  onCancel: () => void
  onDraft: (doc: Doc) => void
  onDiscard: () => void
}) {
  const side = cn("flex min-w-0 flex-col gap-2 text-sm leading-relaxed", KIND_STYLE[segment.kind])
  const translation = cn(side, "break-keep")
  return (
    <article
      data-segment-id={segment.id}
      data-status={segment.status}
      className="grid grid-cols-[minmax(0,1fr)_0.375rem_minmax(0,1fr)] gap-x-4 border-b py-4 last:border-b-0"
    >
      <div data-side="source" lang="en" className={side}>
        <DocText doc={segment.sourceDoc} />
      </div>
      <span role="img" aria-label={STATUS_LABEL[segment.status]} title={STATUS_LABEL[segment.status]} className={cn("mt-2 size-1.5 rounded-full", STATUS_DOT[segment.status])} />
      {editing ? (
        <div data-side="target" data-translated={target !== null}>
          <SegmentEditor doc={editing.doc ?? EMPTY} caret={editing.caret} className={cn(translation, "outline-none")} onLeave={onLeave} onCancel={onCancel} onDraft={onDraft} />
        </div>
      ) : (
        <div className="flex min-w-0 flex-col gap-2">
        <div
          data-side="target"
          data-translated={target !== null}
          lang="ko"
          className={cn(translation, "cursor-text", target === null && "text-muted-foreground")}
          onClick={(event) => {
            // words dragged over to copy are a selection, not a wish to edit
            if (!window.getSelection()?.isCollapsed) return
            onEdit(target ? caretAt(event) : "end")
          }}
        >
          {target ? <DocText doc={target} /> : "Not translated"}
        </div>
        {draft && (
          <div data-draft className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>Unsaved draft{draft.changedSince && " — the paragraph changed since"}</span>
            <Button variant="outline" size="xs" onClick={() => onEdit("end")}>Resume</Button>
            <Button variant="ghost" size="xs" onClick={onDiscard}>Discard</Button>
          </div>
        )}
        </div>
      )}
    </article>
  )
}
