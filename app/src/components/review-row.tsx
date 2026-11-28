import { useEffect, useRef } from "react"
import { GitMergeIcon, ScissorIcon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"

import { SEGMENT_KINDS, type Segment } from "@shared/protocol.ts"

import { DocText } from "@/components/doc-text"
import { EditedMark } from "@/components/edited-mark"
import { SegmentEditor, type EditorHandle } from "@/components/segment-editor"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { SideEdit } from "@/hooks/use-segment-edits"
import { caretAt } from "@/lib/caret"
import { cn } from "@/lib/utils"

export const KIND_LABEL: Record<Segment["kind"], string> = { paragraph: "Paragraph", heading: "Heading", blockquote: "Quote", caption: "Caption", verse: "Verse" }
const KINDS = SEGMENT_KINDS.map((kind) => ({ value: kind, label: KIND_LABEL[kind] }))
const EMPTY = { type: "doc" as const, content: [{ type: "paragraph" as const }] }

/** One paragraph of the source, as the review screen shows it: whether it was checked against the scan, its kind, and
 *  its text — which a click opens for editing. The chosen one is brought into view when chosen from elsewhere. */
export function ReviewRow({ segment, selected, source, hasNext, onSelect, onVerify, onKind, onMerge }: {
  segment: Segment
  selected: boolean
  source: SideEdit
  /** A paragraph follows in the chapter, to merge with. */
  hasNext: boolean
  onSelect: () => void
  onVerify: (verified: boolean) => void
  onKind: (kind: Segment["kind"]) => void
  onMerge: () => void
}) {
  const ref = useRef<HTMLElement>(null)
  const editor = useRef<EditorHandle>(null)
  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ block: "nearest" })
  }, [selected])
  const text = cn("flex flex-col gap-2 leading-relaxed", segment.kind === "heading" && "font-medium", segment.kind === "verse" && "whitespace-pre-wrap")
  return (
    <article
      ref={ref}
      data-segment-id={segment.id}
      data-selected={selected}
      data-verified={segment.verified}
      onClick={onSelect}
      className={cn(
        "flex flex-col gap-1.5 rounded-lg px-3 py-2.5 text-sm",
        selected ? "bg-muted ring-1 ring-border" : "hover:bg-muted/50",
        segment.verified && !selected && "opacity-60",
      )}
    >
      <div className="flex h-7 items-center gap-2 text-xs text-muted-foreground">
        <Checkbox aria-label="Verified" checked={segment.verified} onCheckedChange={(checked) => onVerify(checked)} />
        {selected ? (
          <Select items={KINDS} value={segment.kind} onValueChange={(kind) => kind && onKind(kind)}>
            <SelectTrigger size="sm" aria-label="Kind" data-kind>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {KINDS.map((k) => (
                <SelectItem key={k.value} value={k.value}>{k.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <Badge variant="outline" data-kind>{KIND_LABEL[segment.kind]}</Badge>
        )}
        {segment.pageEnd !== segment.pageStart && <span>→ p. {segment.pageEnd}</span>}
        {segment.ocrText !== null && segment.ocrText !== segment.sourceText && <EditedMark ocrText={segment.ocrText} sourceText={segment.sourceText} />}
        <span className="flex-1" />
        {source.editing ? (
          // pressed without taking the focus from the editor, which knows where the caret is
          <Button variant="ghost" size="xs" onMouseDown={(event) => event.preventDefault()} onClick={() => editor.current?.split()}>
            <HugeiconsIcon icon={ScissorIcon} strokeWidth={2} />
            Split at caret
          </Button>
        ) : (
          selected && (
            <Button variant="ghost" size="xs" disabled={!hasNext} onClick={onMerge}>
              <HugeiconsIcon icon={GitMergeIcon} strokeWidth={2} />
              Merge with next
            </Button>
          )
        )}
      </div>
      {source.editing ? (
        <div data-side="source">
          <SegmentEditor
            ref={editor}
            single
            lang="en"
            doc={source.editing.doc ?? EMPTY}
            caret={source.editing.caret}
            className={cn(text, "outline-none")}
            onLeave={source.onLeave}
            onCancel={source.onCancel}
            onDraft={source.onDraft}
          />
        </div>
      ) : (
        <div
          data-side="source"
          lang="en"
          className={cn(text, "cursor-text")}
          onClick={(event) => {
            // words dragged over to copy are a selection, not a wish to edit
            if (!window.getSelection()?.isCollapsed) return
            source.onEdit(caretAt(event))
          }}
        >
          <DocText doc={source.shown ?? segment.sourceDoc} />
        </div>
      )}
      {source.draft && (
        <div data-draft className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>Unsaved draft{source.draft.changedSince && " — the paragraph changed since"}</span>
          <Button variant="outline" size="xs" onClick={() => source.onEdit("end")}>Resume</Button>
          <Button variant="ghost" size="xs" onClick={source.onDiscard}>Discard</Button>
        </div>
      )}
    </article>
  )
}
