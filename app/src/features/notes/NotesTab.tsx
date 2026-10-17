import { useEffect, useState } from "react"
import { IconCheck, IconMessage, IconTrash } from "@tabler/icons-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Textarea } from "@/components/ui/textarea"
import type { Comment, Note, Segment } from "@/data/api"
import { cn } from "cn"
import { useAnnotations } from "./AnnotationsContext"
import { NotesPanel as UnlinkedNotes } from "@/features/review/NotesPanel"

interface Props {
  segment: Segment | null
  segments: Segment[]
  markers: Map<number, string>
  unlinked: Note[]
  onAnchorUnlinked: (noteId: number, segmentId: number) => Promise<unknown>
}

/** Everything attached to the selected paragraph: comment threads (reply, resolve, delete) and notes
 *  (translator's notes editable, author's notes shown). Unlinked author notes of the book sit below. */
export function NotesTab({ segment: panelSegment, segments, markers, unlinked, onAnchorUnlinked }: Props) {
  const ann = useAnnotations()
  if (!ann) return null
  // a selected comment/note (clicked in the text) wins over the row selection
  const sel = ann.selected
  const selSegmentId = sel
    ? (sel.kind === "comment" ? ann.annotations.comments.find((c) => c.id === sel.id)?.segmentId : ann.annotations.notes.find((n) => n.id === sel.id)?.segmentId)
    : undefined
  const segment = (selSegmentId !== undefined ? segments.find((s) => s.id === selSegmentId) : undefined) ?? panelSegment
  const comments = segment ? ann.annotations.comments.filter((c) => c.segmentId === segment.id) : []
  const roots = comments.filter((c) => c.parentId === null)
  const notes = segment ? ann.annotations.notes.filter((n) => n.segmentId === segment.id) : []
  const open = ann.annotations.comments.filter((c) => c.parentId === null && !c.resolved).length

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-8 shrink-0 items-center gap-2 border-b px-3 text-xs">
        <span className="font-medium">Notes</span>
        <Badge variant={open ? "secondary" : "outline"} data-open-comments>{open} open</Badge>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        {!segment ? (
          <p className="p-3 text-xs text-muted-foreground">Select a paragraph.</p>
        ) : roots.length + notes.length === 0 ? (
          <p className="p-3 text-xs text-muted-foreground">Nothing here yet. Select text and choose Comment or Translator's note.</p>
        ) : (
          <ul className="divide-y text-xs" aria-label="Notes of this paragraph">
            {roots.map((c) => <Thread key={c.id} root={c} replies={comments.filter((r) => r.parentId === c.id)} />)}
            {notes.map((n) => <NoteItem key={n.id} note={n} label={markers.get(n.id)} />)}
          </ul>
        )}
        {unlinked.length > 0 && (
          <div className="border-t">
            <div className="px-3 pt-2 text-xs font-medium text-muted-foreground">Unlinked author notes · {unlinked.length}</div>
            <UnlinkedNotes notes={unlinked} segments={segments} onAnchor={onAnchorUnlinked} />
          </div>
        )}
      </ScrollArea>
    </div>
  )
}

function Thread({ root, replies }: { root: Comment; replies: Comment[] }) {
  const ann = useAnnotations()!
  const selected = ann.selected?.kind === "comment" && ann.selected.id === root.id
  const [reply, setReply] = useState("")
  const ref = useScrollWhen(selected)
  return (
    <li ref={ref} data-panel-comment={root.id} onClick={() => ann.select({ kind: "comment", id: root.id })}
      className={cn("space-y-1.5 border-l-2 border-transparent px-3 py-2", selected && "border-mark-comment bg-muted", root.resolved && "opacity-50")}>
      <div className="flex items-center gap-2">
        <IconMessage className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate text-muted-foreground" lang={root.side === "source" ? "en" : "ko"}>“{root.anchor?.exact ?? "paragraph"}”</span>
        <span className="ml-auto flex shrink-0">
          <Button size="icon-xs" variant="ghost" aria-label={root.resolved ? "Reopen" : "Resolve"}
            onClick={(e) => { e.stopPropagation(); void ann.actions.setComment(root.id, { resolved: !root.resolved }) }}>
            <IconCheck className={cn(root.resolved && "text-mark-term-ink")} />
          </Button>
          <Button size="icon-xs" variant="ghost" aria-label="Delete comment" onClick={(e) => { e.stopPropagation(); void ann.actions.deleteComment(root.id) }}>
            <IconTrash />
          </Button>
        </span>
      </div>
      <p className={cn(root.resolved && "line-through")}>{root.body}</p>
      {replies.map((r) => <p key={r.id} className="border-l-2 pl-2 text-muted-foreground">{r.body}</p>)}
      {selected && !root.resolved && (
        <Textarea value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Reply…" aria-label="Reply" rows={1} className="min-h-8 text-xs"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && reply.trim()) { e.preventDefault(); void ann.actions.addComment(root.segmentId, root.side, null, reply.trim(), root.id); setReply("") }
          }} />
      )}
    </li>
  )
}

function NoteItem({ note, label }: { note: Note; label?: string }) {
  const ann = useAnnotations()!
  const selected = ann.selected?.kind === "note" && ann.selected.id === note.id
  const [body, setBody] = useState(note.bodyTarget)
  useEffect(() => setBody(note.bodyTarget), [note.bodyTarget])
  const ref = useScrollWhen(selected)
  const translator = note.kind === "translator"
  return (
    <li ref={ref} data-panel-note={note.id} onClick={() => ann.select({ kind: "note", id: note.id })}
      className={cn("space-y-1 border-l-2 border-transparent px-3 py-2", selected && "border-mark-note bg-muted")}>
      <div className="flex items-center gap-2">
        <sup className="border-b-2 border-mark-note bg-mark-note/40 px-0.5 text-[11px] font-medium text-mark-note-ink">{label ?? (translator ? "*" : "–")}</sup>
        <span className="text-muted-foreground">{translator ? "Translator's note" : "Author's note"}</span>
        {note.targetAnchor ? (
          <span className="ml-auto truncate text-muted-foreground" lang="ko">“{note.targetAnchor.exact}”</span>
        ) : (
          <span className="ml-auto text-muted-foreground" title="Select the words in the translation, then “Place note”">not placed</span>
        )}
        {translator && (
          <Button size="icon-xs" variant="ghost" aria-label="Delete note" onClick={(e) => { e.stopPropagation(); void ann.actions.deleteNote(note.id) }}>
            <IconTrash />
          </Button>
        )}
      </div>
      {translator ? (
        <Textarea value={body} lang="ko" aria-label="Note body" rows={2} className="min-h-8 text-xs"
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => setBody(e.target.value)}
          onBlur={() => { if (body.trim() && body !== note.bodyTarget) void ann.actions.setNote(note.id, { body: body.trim() }) }} />
      ) : (
        <p className="reading text-[13px] text-muted-foreground" lang="en">{note.bodySource}</p>
      )}
    </li>
  )
}

function useScrollWhen(on: boolean) {
  const [el, setEl] = useState<HTMLLIElement | null>(null)
  useEffect(() => { if (on) el?.scrollIntoView({ block: "nearest" }) }, [on, el])
  return setEl
}
