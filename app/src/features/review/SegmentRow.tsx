import { useEffect, useRef, useState } from "react"
import { IconArrowsSplit2, IconPencil, IconRowInsertBottom } from "@tabler/icons-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger,
} from "@/components/ui/context-menu"
import { Textarea } from "@/components/ui/textarea"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { SourceText } from "./SourceText"
import { cn } from "cn"
import type { Segment, SegmentKind, SegmentPatch } from "@/data/api"

export const KIND_LABEL: Record<SegmentKind, string> = {
  paragraph: "단락",
  heading: "제목",
  blockquote: "인용",
  caption: "캡션",
  verse: "운문",
}
const KINDS = Object.keys(KIND_LABEL) as SegmentKind[]

interface Props {
  segment: Segment
  selected: boolean
  editing: boolean
  hasNext: boolean
  onSelect: () => void
  onEditingChange: (editing: boolean) => void
  onPatch: (patch: SegmentPatch) => Promise<unknown>
  onSplit: (offset: number) => Promise<unknown>
  onMerge: () => Promise<unknown>
}

export function SegmentRow({ segment: s, selected, editing, hasNext, onSelect, onEditingChange, onPatch, onSplit, onMerge }: Props) {
  const setEditing = onEditingChange
  const [draft, setDraft] = useState(s.sourceText)
  const ref = useRef<HTMLDivElement>(null)
  const boxRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ block: "nearest" })
  }, [selected])
  useEffect(() => {
    if (!editing) setDraft(s.sourceText)
  }, [s.sourceText, editing])

  const commit = async () => {
    const text = draft.trim()
    if (text && text !== s.sourceText) await onPatch({ sourceText: text })
    setEditing(false)
  }
  /** Split at the caret. Unsaved edits are saved first so the offset refers to the stored text. */
  const splitAtCaret = async () => {
    const box = boxRef.current
    if (!box) return
    const offset = box.selectionStart
    const text = draft.trim()
    if (text !== s.sourceText) await onPatch({ sourceText: text })
    setEditing(false)
    await onSplit(offset)
  }

  return (
    <ContextMenu>
    <ContextMenuTrigger
      ref={ref}
      onClick={onSelect}
      className={cn(
        "group mb-2 rounded-md border border-transparent px-2 py-1.5",
        "hover:bg-muted/50",
        selected && "border-border bg-muted/60",
        s.verified && !selected && "opacity-60",
      )}
    >
      <div className="mb-1 flex h-6 items-center gap-1.5 text-xs">
        <label className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
          <Checkbox checked={s.verified} onCheckedChange={(v) => void onPatch({ verified: v })} aria-label="확인됨" />
          <span className="text-muted-foreground">확인</span>
        </label>
        {selected ? (
          <ToggleGroup
            value={[s.kind]}
            onValueChange={(v) => v[0] && v[0] !== s.kind && void onPatch({ kind: v[0] as SegmentKind })}
            size="sm"
            variant="outline"
            spacing={0}
            className="ml-1"
            onClick={(e) => e.stopPropagation()}
          >
            {KINDS.map((k) => (
              <ToggleGroupItem key={k} value={k} aria-label={KIND_LABEL[k]}>
                {KIND_LABEL[k]}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        ) : (
          <Badge variant={s.kind === "paragraph" ? "outline" : "secondary"}>{KIND_LABEL[s.kind]}</Badge>
        )}
        {s.pageEnd !== s.pageStart && <span className="text-muted-foreground tabular-nums">→ p. {s.pageEnd}</span>}
        {selected && (
          <span className="ml-auto flex items-center" onClick={(e) => e.stopPropagation()}>
            {editing ? (
              <Button variant="ghost" size="xs" aria-label="커서 위치에서 분할" onMouseDown={(e) => e.preventDefault()}
                onClick={() => void splitAtCaret()}>
                <IconArrowsSplit2 data-icon="inline-start" /> 분할
              </Button>
            ) : (
              <Button variant="ghost" size="icon-xs" aria-label="텍스트 수정" onClick={() => setEditing(true)}>
                <IconPencil />
              </Button>
            )}
            <Button variant="ghost" size="icon-xs" aria-label="다음 단락과 병합" disabled={!hasNext}
              onClick={() => void onMerge()}>
              <IconRowInsertBottom />
            </Button>
          </span>
        )}
      </div>
      {editing ? (
        <Textarea
          ref={boxRef}
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => void commit()}
          onKeyDown={(e) => {
            if (e.key === "Escape") { setDraft(s.sourceText); setEditing(false) }
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void commit()
          }}
          className="reading min-h-24 text-[15px]"
          lang="en"
        />
      ) : (
        <p className={cn("reading text-[15px]", s.kind === "heading" && "font-semibold")} lang="en">
          <SourceText text={s.sourceText} ocr={s.ocrText} />
        </p>
      )}
    </ContextMenuTrigger>
    <ContextMenuContent>
      <ContextMenuItem onClick={() => { onSelect(); setEditing(true) }}>텍스트 수정</ContextMenuItem>
      <ContextMenuItem disabled={!hasNext} onClick={() => void onMerge()}>다음 단락과 병합</ContextMenuItem>
    </ContextMenuContent>
    </ContextMenu>
  )
}
