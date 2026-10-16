import { useCallback, useEffect, useRef } from "react"
import type { Editor } from "@tiptap/react"
import { IconArrowsSplit2, IconPencil, IconRowInsertBottom } from "@tabler/icons-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger,
} from "@/components/ui/context-menu"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { SourceText } from "./SourceText"
import { SegmentEditor, caretOffset } from "./SegmentEditor"
import { cn } from "cn"
import type { DocJSON, Segment, SegmentKind, SegmentPatch } from "@/data/api"

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
  const ref = useRef<HTMLDivElement>(null)
  const editorRef = useRef<Editor | null>(null)
  const closing = useRef(false)

  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ block: "nearest" })
  }, [selected])
  useEffect(() => {
    if (!editing) closing.current = false
  }, [editing])

  /** Persist the edited doc (if changed) and leave edit mode. Guarded: blur and Enter can both fire. */
  const commit = useCallback(
    async (doc: DocJSON) => {
      if (closing.current) return
      closing.current = true
      setEditing(false)
      if (JSON.stringify(doc) !== JSON.stringify(s.sourceDoc)) await onPatch({ sourceDoc: doc })
    },
    [onPatch, s.sourceDoc, setEditing],
  )
  const cancel = useCallback(() => {
    closing.current = true
    setEditing(false)
  }, [setEditing])
  /** Split at the caret. Unsaved edits are saved first so the offset refers to the stored text. */
  const splitAtCaret = async () => {
    const e = editorRef.current
    if (!e) return
    const offset = caretOffset(e)
    const doc = e.getJSON() as DocJSON
    closing.current = true
    setEditing(false)
    if (JSON.stringify(doc) !== JSON.stringify(s.sourceDoc)) await onPatch({ sourceDoc: doc })
    await onSplit(offset)
  }
  const onReady = useCallback((e: Editor) => { editorRef.current = e }, [])

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
        <SegmentEditor
          doc={s.sourceDoc}
          className={cn("reading text-[15px] outline-none", s.kind === "heading" && "font-semibold")}
          onCommit={(doc) => void commit(doc)}
          onCancel={cancel}
          onReady={onReady}
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
