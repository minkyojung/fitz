import { useCallback, useEffect, useRef, useState } from "react"
import type { Editor } from "@tiptap/react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { SourceText } from "@/features/review/SourceText"
import { SegmentEditor } from "@/features/review/SegmentEditor"
import { useDrafts } from "@/features/review/DraftContext"
import { docPlainText, emptyDoc } from "@/lib/docText"
import type { DocJSON, Segment, SegmentPatch, SegmentStatus } from "@/data/api"
import { cn } from "cn"

export const STATUS_DOT: Record<SegmentStatus, string> = {
  untranslated: "bg-border", draft: "bg-muted-foreground/40", reviewed: "bg-mark-note", final: "bg-mark-term",
}
export const STATUS_LABEL: Record<SegmentStatus, string> = {
  untranslated: "Untranslated", draft: "Draft", reviewed: "Reviewed", final: "Final",
}

interface Props {
  segment: Segment
  selected: boolean
  editing: boolean
  /** Where the caret goes when editing starts by keyboard flow. */
  caretEdge: "start" | "end"
  dim: boolean
  onSelect: () => void
  onEditingChange: (editing: boolean) => void
  onPatch: (patch: SegmentPatch) => Promise<unknown>
  onConfirm: (doc: DocJSON) => void
  onStep: (delta: 1 | -1) => void
  onFlow: (delta: 1 | -1) => void
}

/** One facing pair: status dot, source (read-only), translation (click to edit). */
export function PairRow({ segment: s, selected, editing, caretEdge, dim, onSelect, onEditingChange, onPatch, onConfirm, onStep, onFlow }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const closing = useRef(false)
  const clickPos = useRef<number | null>(null)
  const drafts = useDrafts()
  const [, bump] = useState(0)
  const [editDoc, setEditDoc] = useState<DocJSON | null>(null)

  useEffect(() => { if (selected) ref.current?.scrollIntoView({ block: "nearest" }) }, [selected])
  useEffect(() => { if (!editing) { closing.current = false; clickPos.current = null } }, [editing])

  const draft = !editing && drafts ? drafts.load(s.id, "target") : null
  const recoverable = draft && draft.baseText === s.targetText ? draft : null
  useEffect(() => { if (draft && !recoverable) drafts?.clear(s.id, "target") }, [draft, recoverable, drafts, s.id])

  const currentDoc = s.targetDoc ?? emptyDoc()
  const same = (a: DocJSON, b: DocJSON) => JSON.stringify(a) === JSON.stringify(b)

  const commit = useCallback(
    async (doc: DocJSON) => {
      if (closing.current) return
      closing.current = true
      onEditingChange(false)
      setEditDoc(null)
      const text = docPlainText(doc).trim()
      const next: DocJSON | null = text ? doc : null
      if (same(doc, currentDoc) || (!text && !s.targetDoc)) { drafts?.clear(s.id, "target"); return }
      const saved = await onPatch({ targetDoc: next })
      if (saved) drafts?.clear(s.id, "target")
    },
    [onEditingChange, onPatch, currentDoc, s.targetDoc, s.id, drafts],
  )
  const cancel = useCallback(() => { closing.current = true; onEditingChange(false); setEditDoc(null); drafts?.clear(s.id, "target") }, [onEditingChange, drafts, s.id])
  const saveDraft = useCallback((doc: DocJSON) => drafts?.save(s.id, doc, s.targetText, "target"), [drafts, s.id, s.targetText])
  const confirm = useCallback((doc: DocJSON) => { closing.current = true; onEditingChange(false); setEditDoc(null); drafts?.clear(s.id, "target"); onConfirm(doc) }, [onEditingChange, drafts, s.id, onConfirm])
  const onReady = useCallback((_e: Editor) => undefined, [])

  const startEdit = (e: React.MouseEvent<HTMLElement>) => {
    if (editing) return
    clickPos.current = docPosAtPoint(e.currentTarget, e.clientX, e.clientY)
    onSelect()
    onEditingChange(true)
  }

  const blocks = s.targetText ? s.targetText.split("\n") : []
  return (
    <div
      ref={ref}
      data-pair={s.id}
      onClick={onSelect}
      className={cn("col-span-3 grid grid-cols-subgrid scroll-mt-8 py-3 transition-opacity", dim && "opacity-30")}
    >
      <div className="pt-2">
        <span className={cn("block size-2 rounded-full", STATUS_DOT[s.status])} title={STATUS_LABEL[s.status]} data-status={s.status} />
      </div>
      <p className={cn("reading text-[15px] text-muted-foreground", s.kind === "heading" && "font-semibold text-foreground")} lang="en">
        <SourceText text={s.sourceText} ocr={s.ocrText} />
      </p>
      <div className="min-w-0">
        {recoverable && !editing && (
          <div className="mb-1 flex items-center gap-1 text-xs" onClick={(e) => e.stopPropagation()}>
            <Badge variant="destructive">Unsaved</Badge>
            <Button size="xs" variant="outline" onClick={() => { setEditDoc(recoverable.doc); onSelect(); onEditingChange(true) }}>Recover</Button>
            <Button size="xs" variant="ghost" onClick={() => { drafts?.clear(s.id, "target"); bump((n) => n + 1) }}>Discard</Button>
          </div>
        )}
        {editing ? (
          <SegmentEditor
            doc={editDoc ?? currentDoc}
            multiParagraph
            lang="ko"
            caretOffset={clickPos.current ?? (caretEdge === "start" ? 0 : null)}
            className={cn("reading text-[15px] outline-none [&_p+p]:mt-3", s.kind === "heading" && "font-semibold")}
            onCommit={(doc) => void commit(doc)}
            onCancel={cancel}
            onConfirm={confirm}
            onStep={onStep}
            onFlow={onFlow}
            onDraft={saveDraft}
            onReady={onReady}
          />
        ) : (
          <div
            lang="ko"
            data-target
            onClick={startEdit}
            className={cn("reading cursor-text text-[15px] [&_p+p]:mt-3", s.kind === "heading" && "font-semibold", !blocks.length && "text-muted-foreground/50")}
          >
            {blocks.length ? blocks.map((b, i) => <p key={i}>{b}</p>) : <p>Translate…</p>}
          </div>
        )}
      </div>
    </div>
  )
}

/** Document position (ProseMirror) of a click inside a multi-paragraph read view: paragraph boundaries cost 2. */
function docPosAtPoint(root: HTMLElement, x: number, y: number): number | null {
  const doc = document as Document & { caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null }
  let node: Node | null = null
  let offset = 0
  if (doc.caretPositionFromPoint) { const p = doc.caretPositionFromPoint(x, y); if (p) { node = p.offsetNode; offset = p.offset } }
  else { const r = document.caretRangeFromPoint(x, y); if (r) { node = r.startContainer; offset = r.startOffset } }
  if (!node || !root.contains(node)) return null
  let pos = 0
  for (const p of Array.from(root.querySelectorAll("p"))) {
    pos += 1 // paragraph open
    const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT)
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (n === node) return pos + offset - 1 // SegmentEditor adds 1 for the first paragraph's open token
      pos += n.textContent?.length ?? 0
    }
    pos += 1 // paragraph close
  }
  return null
}
