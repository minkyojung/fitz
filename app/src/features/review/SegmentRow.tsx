import { useCallback, useEffect, useMemo, useRef, useState } from "react"
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
import { useDrafts } from "./DraftContext"
import { CAPTION_PLACEHOLDER } from "@/data/useBook"
import { useSpell } from "./SpellContext"
import { findSuspects, type Suspect } from "@/lib/spell"
import { replaceRangeInDoc } from "@/lib/docText"
import { findTerms } from "@/lib/glossary"
import { cn } from "cn"
import type { DocJSON, Segment, SegmentKind, SegmentPatch } from "@/data/api"

/** Character offset within `root`'s text content under a viewport point, or null if not over text. */
function textOffsetAtPoint(root: HTMLElement, x: number, y: number): number | null {
  const doc = document as Document & { caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null }
  let node: Node | null = null
  let offset = 0
  if (doc.caretPositionFromPoint) {
    const p = doc.caretPositionFromPoint(x, y)
    if (p) { node = p.offsetNode; offset = p.offset }
  } else {
    const r = document.caretRangeFromPoint(x, y)
    if (r) { node = r.startContainer; offset = r.startOffset }
  }
  if (!node || !root.contains(node)) return null
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let total = 0
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n === node) return total + offset
    total += n.textContent?.length ?? 0
  }
  return null
}

export const KIND_LABEL: Record<SegmentKind, string> = {
  paragraph: "Paragraph",
  heading: "Heading",
  blockquote: "Quote",
  caption: "Caption",
  verse: "Verse",
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
  onStep?: (delta: 1 | -1) => void
}

export function SegmentRow({ segment: s, selected, editing, hasNext, onSelect, onEditingChange, onPatch, onSplit, onMerge, onStep }: Props) {
  const setEditing = onEditingChange
  const ref = useRef<HTMLDivElement>(null)
  const editorRef = useRef<Editor | null>(null)
  const closing = useRef(false)
  const clickOffset = useRef<number | null>(null)
  const drafts = useDrafts()
  const spell = useSpell()
  // dictionary suspects, recomputed whenever the text, the dictionary or the person's words change
  const speller = spell?.speller ?? null
  const userWords = spell?.userWords
  const suspects = useMemo<Suspect[]>(
    () => (speller && userWords && !editing ? findSuspects(s.sourceText, speller.correct, userWords) : []),
    [speller, userWords, s.sourceText, editing],
  )
  const glossary = spell?.glossary
  const terms = useMemo(() => (glossary && !editing ? findTerms(s.sourceText, glossary) : []), [glossary, s.sourceText, editing])
  /** Accept a spelling fix without opening the editor: a normal (undoable) text edit. */
  const acceptFix = (sp: Suspect, replacement: string) => {
    const doc = s.sourceDoc ?? { type: "doc" as const, content: [{ type: "paragraph" as const, content: [{ type: "text" as const, text: s.sourceText }] }] }
    void onPatch({ sourceDoc: replaceRangeInDoc(doc, sp.start, sp.end, replacement) })
  }
  const [, bump] = useState(0)
  const discard = () => { drafts?.clear(s.id); bump((n) => n + 1) }
  /** A draft is only offered while the server text is what it was based on; otherwise it is stale and dropped. */
  const draft = !editing && drafts ? drafts.load(s.id) : null
  const recoverable = draft && draft.baseText === s.sourceText ? draft : null
  useEffect(() => {
    if (draft && !recoverable) drafts?.clear(s.id) // stale: the server text moved on
  }, [draft, recoverable, drafts, s.id])
  const [editDoc, setEditDoc] = useState<DocJSON | null>(null)

  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ block: "nearest" })
  }, [selected])
  useEffect(() => {
    if (!editing) { closing.current = false; clickOffset.current = null }
  }, [editing])

  /** Clicking the text starts editing right there. The offset is measured on the read view before
   *  anything scrolls, so it survives the selection's scrollIntoView. */
  const startEditAt = (e: React.MouseEvent<HTMLParagraphElement>) => {
    if (editing) return
    clickOffset.current = textOffsetAtPoint(e.currentTarget, e.clientX, e.clientY)
    onSelect()
    setEditing(true)
  }

  /** Persist the edited doc (if changed) and leave edit mode. Guarded: blur and Enter can both fire.
   *  The draft is cleared only once the server accepted the change. */
  const commit = useCallback(
    async (doc: DocJSON) => {
      if (closing.current) return
      closing.current = true
      setEditing(false)
      setEditDoc(null)
      if (JSON.stringify(doc) === JSON.stringify(s.sourceDoc)) { drafts?.clear(s.id); return }
      const saved = await onPatch({ sourceDoc: doc })
      if (saved) drafts?.clear(s.id)
    },
    [onPatch, s.sourceDoc, s.id, setEditing, drafts],
  )
  const cancel = useCallback(() => {
    closing.current = true
    setEditing(false)
    setEditDoc(null)
    drafts?.clear(s.id)
  }, [setEditing, drafts, s.id])
  const saveDraft = useCallback((doc: DocJSON) => drafts?.save(s.id, doc, s.sourceText), [drafts, s.id, s.sourceText])
  const recover = () => {
    if (!recoverable) return
    setEditDoc(recoverable.doc)
    onSelect()
    setEditing(true)
  }
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
      data-segment={s.id}
      onClick={onSelect}
      className={cn(
        "group mb-2 scroll-mt-8 rounded-md border border-transparent px-2 py-1.5", // scroll-mt clears the sticky page header
        "hover:bg-muted/50",
        selected && "border-border bg-muted/60",
        s.verified && !selected && "opacity-60",
      )}
    >
      <div className="mb-1 flex min-h-6 flex-wrap items-center gap-x-1.5 gap-y-1 text-xs">
        <label className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
          <Checkbox checked={s.verified} onCheckedChange={(v) => void onPatch({ verified: v })} aria-label="Verified" />
          <span className="text-muted-foreground">Verify</span>
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
        {suspects.length > 0 && <span data-suspects className="text-muted-foreground tabular-nums">Suspects {suspects.length}</span>}
        {recoverable && (
          <span className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
            <Badge variant="destructive">Unsaved</Badge>
            <Button size="xs" variant="outline" onClick={recover}>Recover</Button>
            <Button size="xs" variant="ghost" onClick={discard}>Discard</Button>
          </span>
        )}
        {selected && (
          <span className="ml-auto flex items-center" onClick={(e) => e.stopPropagation()}>
            {editing ? (
              <Button variant="ghost" size="xs" aria-label="Split at caret" onMouseDown={(e) => e.preventDefault()}
                onClick={() => void splitAtCaret()}>
                <IconArrowsSplit2 data-icon="inline-start" /> Split
              </Button>
            ) : (
              <Button variant="ghost" size="icon-xs" aria-label="Edit text" onClick={() => setEditing(true)}>
                <IconPencil />
              </Button>
            )}
            <Button variant="ghost" size="icon-xs" aria-label="Merge with next" disabled={!hasNext}
              onClick={() => void onMerge()}>
              <IconRowInsertBottom />
            </Button>
          </span>
        )}
      </div>
      {editing ? (
        <SegmentEditor
          doc={editDoc ?? s.sourceDoc ?? { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: s.sourceText }] }] }}
          caretOffset={clickOffset.current}
          selectAll={s.sourceText === CAPTION_PLACEHOLDER}
          className={cn("reading text-[15px] outline-none", s.kind === "heading" && "font-semibold")}
          onCommit={(doc) => void commit(doc)}
          onCancel={cancel}
          onStep={onStep}
          onDraft={saveDraft}
          onReady={onReady}
        />
      ) : (
        <p
          className={cn("reading cursor-text select-text text-[15px]", s.kind === "heading" && "font-semibold")}
          lang="en"
          onClick={startEditAt}
        >
          <SourceText text={s.sourceText} ocr={s.ocrText} suspects={suspects} onAcceptFix={acceptFix} terms={terms} />
        </p>
      )}
    </ContextMenuTrigger>
    <ContextMenuContent>
      <ContextMenuItem onClick={() => { onSelect(); setEditing(true) }}>Edit text</ContextMenuItem>
      <ContextMenuItem disabled={!hasNext} onClick={() => void onMerge()}>Merge with next</ContextMenuItem>
    </ContextMenuContent>
    </ContextMenu>
  )
}
