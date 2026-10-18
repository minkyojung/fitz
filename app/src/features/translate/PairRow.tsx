import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { Editor } from "@tiptap/react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { SourceText } from "@/features/review/SourceText"
import { EditedDot } from "@/features/review/EditedDot"
import { AnnotatedText } from "@/features/notes/AnnotatedText"
import { useSelectionState } from "@/features/selection/SelectionContext"
import { SegmentEditor } from "@/features/review/SegmentEditor"
import { useDrafts } from "@/features/review/DraftContext"
import { useSpell } from "@/features/review/SpellContext"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { findTerms, missingTerms } from "@/lib/glossary"
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
  /** Footnote labels by note id for this chapter. */
  markers: Map<number, string>
  onSelect: () => void
  onEditingChange: (editing: boolean) => void
  /** Resolves to the saved segment, or null when nothing was saved. */
  onPatch: (patch: SegmentPatch) => Promise<unknown>
  /** ⌘Enter: save as reviewed. Resolves true once saved. */
  onConfirm: (doc: DocJSON, expectVersion: number | undefined) => Promise<boolean>
  onStep: (delta: 1 | -1) => void
  onFlow: (delta: 1 | -1) => void
}

/** One facing pair: status dot, source (read-only), translation (click to edit). */
export function PairRow({ segment: s, selected, editing, caretEdge, dim, markers, onSelect, onEditingChange, onPatch, onConfirm, onStep, onFlow }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const closing = useRef(false)
  const clickPos = useRef<number | null>(null)
  const drafts = useDrafts()
  const selectionState = useSelectionState()
  const [, bump] = useState(0)
  const [editDoc, setEditDoc] = useState<DocJSON | null>(null)
  const glossary = useSpell()?.glossary
  const terms = useMemo(() => (glossary ? findTerms(s.sourceText, glossary) : []), [glossary, s.sourceText])
  const missing = useMemo(() => (editing ? [] : missingTerms(terms, s.targetText)), [terms, s.targetText, editing])

  useEffect(() => { if (selected) ref.current?.scrollIntoView({ block: "nearest" }) }, [selected])
  // What this edit started from. A save names its version, so it never overwrites what another writer (the agent,
  // another window) did meanwhile; "unchanged" means unchanged from it, not from whatever the screen shows now.
  const base = useRef<{ version: number; text: string; doc: DocJSON } | null>(null)
  useEffect(() => {
    if (!editing) { closing.current = false; clickPos.current = null; base.current = null }
    else base.current ??= { version: s.version, text: s.targetText, doc: s.targetDoc ?? emptyDoc() }
  }, [editing]) // eslint-disable-line react-hooks/exhaustive-deps -- the base is what was shown when editing began

  // An unsaved draft is never dropped silently: if the paragraph changed since it was written, it says so.
  const draft = !editing && drafts ? drafts.load(s.id, "target") : null
  const changedSince = draft !== null && draft.baseText !== s.targetText

  const currentDoc = s.targetDoc ?? emptyDoc()
  const same = (a: DocJSON, b: DocJSON) => JSON.stringify(a) === JSON.stringify(b)
  /** After a save: the draft goes once the server took the text; otherwise the text stays as a draft. */
  const settle = useCallback(
    (saved: boolean, doc: DocJSON, from: typeof base.current) => {
      if (saved) drafts?.clear(s.id, "target")
      else { drafts?.save(s.id, doc, from?.text ?? s.targetText, "target"); bump((n) => n + 1) }
    },
    [drafts, s.id, s.targetText],
  )

  const commit = useCallback(
    async (doc: DocJSON) => {
      if (closing.current) return
      closing.current = true
      const from = base.current
      onEditingChange(false)
      setEditDoc(null)
      const text = docPlainText(doc).trim()
      const next: DocJSON | null = text ? doc : null
      if (same(doc, from?.doc ?? currentDoc) || (!text && !from?.text)) { drafts?.clear(s.id, "target"); return }
      settle(Boolean(await onPatch({ targetDoc: next, expectVersion: from?.version })), doc, from)
    },
    [onEditingChange, onPatch, currentDoc, s.id, drafts, settle],
  )
  const cancel = useCallback(() => { closing.current = true; onEditingChange(false); setEditDoc(null); drafts?.clear(s.id, "target") }, [onEditingChange, drafts, s.id])
  const saveDraft = useCallback((doc: DocJSON) => drafts?.save(s.id, doc, base.current?.text ?? s.targetText, "target"), [drafts, s.id, s.targetText])
  const confirm = useCallback(
    async (doc: DocJSON) => {
      closing.current = true
      const from = base.current
      onEditingChange(false)
      setEditDoc(null)
      settle(await onConfirm(doc, from?.version), doc, from)
    },
    [onEditingChange, onConfirm, settle],
  )
  const onReady = useCallback((_e: Editor) => undefined, [])

  const startEdit = (e: React.MouseEvent<HTMLElement>) => {
    if (editing) return
    if (!window.getSelection()?.isCollapsed) return // a drag-selection, not a click: leave it for the toolbar
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
      <div className="flex flex-col items-center gap-1.5 pt-2">
        <span className={cn("block size-2 rounded-full", STATUS_DOT[s.status])} title={STATUS_LABEL[s.status]} data-status={s.status} />
        <EditedDot ocr={s.ocrText} text={s.sourceText} />
        {missing.length > 0 && (
          <Tooltip>
            <TooltipTrigger render={<span data-term-missing className="block size-2 rounded-full bg-mark-warning ring-1 ring-mark-warning-ink/60" />} />
            <TooltipContent side="right">
              Glossary: {missing.map((e) => `${e.term} → ${e.translation}`).join(", ")} not found in the translation
            </TooltipContent>
          </Tooltip>
        )}
      </div>
      <p className={cn("reading select-text text-[15px] text-muted-foreground", s.kind === "heading" && "font-semibold text-foreground")} lang="en">
        <AnnotatedText text={s.sourceText} segmentId={s.id} side="source" renderPlain={(t, a, b) => <SourceText text={t} from={a} to={b} terms={terms} />} />
      </p>
      <div className="min-w-0">
        {draft && !editing && (
          <div data-unsaved className="mb-1 flex items-center gap-1 text-xs" onClick={(e) => e.stopPropagation()}>
            <Badge variant="destructive">Unsaved</Badge>
            {changedSince && <span className="text-muted-foreground">the paragraph changed since</span>}
            <Button size="xs" variant="outline" onClick={() => { setEditDoc(draft.doc); onSelect(); onEditingChange(true) }}>Recover</Button>
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
            onConfirm={(doc) => void confirm(doc)}
            onStep={onStep}
            onFlow={onFlow}
            onDraft={saveDraft}
            onReady={onReady}
            onSelect={(sel) => selectionState?.publish(sel ? { ...sel, segmentId: s.id, side: "target" } : null)}
          />
        ) : (
          <div
            lang="ko"
            data-target
            onClick={startEdit}
            className={cn("reading cursor-text text-[15px] [&_p+p]:mt-3", s.kind === "heading" && "font-semibold", !blocks.length && "text-muted-foreground/50")}
          >
            {blocks.length
              ? blocks.map((b, i) => <p key={i}><AnnotatedText text={b} segmentId={s.id} side="target" markers={markers} last={i === blocks.length - 1} /></p>)
              : <p>Translate…</p>}
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
