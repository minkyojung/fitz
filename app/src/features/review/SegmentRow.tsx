import { useEffect, useRef, useState } from "react"
import { IconPencil } from "@tabler/icons-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Textarea } from "@/components/ui/textarea"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
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
  onSelect: () => void
  onPatch: (patch: SegmentPatch) => Promise<unknown>
}

export function SegmentRow({ segment: s, selected, onSelect, onPatch }: Props) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(s.sourceText)
  const ref = useRef<HTMLDivElement>(null)

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

  return (
    <div
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
        {selected && !editing && (
          <Button
            variant="ghost"
            size="icon-xs"
            className="ml-auto"
            aria-label="텍스트 수정"
            onClick={(e) => {
              e.stopPropagation()
              setEditing(true)
            }}
          >
            <IconPencil />
          </Button>
        )}
      </div>
      {editing ? (
        <Textarea
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
          {s.sourceText}
        </p>
      )}
    </div>
  )
}
