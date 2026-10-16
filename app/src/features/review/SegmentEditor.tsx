import { useEffect, useRef } from "react"
import { EditorContent, useEditor, type Editor } from "@tiptap/react"
import Document from "@tiptap/extension-document"
import Paragraph from "@tiptap/extension-paragraph"
import Text from "@tiptap/extension-text"
import Italic from "@tiptap/extension-italic"
import { History } from "@tiptap/extension-history"
import { Extension } from "@tiptap/core"

import type { DocJSON } from "@/data/api"

/** Exactly one paragraph: the schema cannot hold a second one, so Enter means "done". */
const OneParagraph = Document.extend({ content: "paragraph" })

interface Props {
  doc: DocJSON
  className?: string
  /** Character offset to place the caret at (computed from the click on the read view). */
  caretOffset?: number | null
  /** Select everything on open (placeholder text meant to be overwritten). */
  selectAll?: boolean
  /** Called with the edited doc. The caller persists it. */
  onCommit: (doc: DocJSON) => void
  onCancel: () => void
  /** Tab / Shift-Tab: commit, then continue editing the next / previous paragraph. */
  onStep?: (delta: 1 | -1) => void
  /** Called with the current doc shortly after typing pauses (crash insurance). */
  onDraft?: (doc: DocJSON) => void
  onReady?: (editor: Editor) => void
}

/** Text offset of the caret inside the single paragraph (position 0 is the paragraph's opening token). */
export const caretOffset = (editor: Editor) => editor.state.selection.from - 1

/** In-place paragraph editor. Same `.reading` classes as the read view, so nothing shifts when it mounts. */
const DRAFT_DELAY = 300

export function SegmentEditor({ doc, className, caretOffset, selectAll, onCommit, onCancel, onStep, onDraft, onReady }: Props) {
  const draftTimer = useRef<number | undefined>(undefined)
  const editor = useEditor({
    extensions: [
      OneParagraph,
      Paragraph,
      Text,
      Italic,
      History,
      Extension.create({
        name: "commitKeys",
        addKeyboardShortcuts() {
          return {
            Enter: () => { commit(this.editor as Editor); return true },
            "Mod-Enter": () => { commit(this.editor as Editor); return true },
            Escape: () => { onCancel(); return true },
            Tab: () => { commit(this.editor as Editor); onStep?.(1); return true },
            "Shift-Tab": () => { commit(this.editor as Editor); onStep?.(-1); return true },
          }
        },
      }),
    ],
    content: doc,
    editorProps: {
      attributes: { class: className ?? "", lang: "en", "aria-label": "Edit paragraph", spellcheck: "true" },
    },
    onBlur: ({ editor }) => commit(editor),
    onUpdate: ({ editor }) => {
      if (!onDraft) return
      window.clearTimeout(draftTimer.current)
      draftTimer.current = window.setTimeout(() => onDraft(editor.getJSON() as DocJSON), DRAFT_DELAY)
    },
  })
  useEffect(() => () => window.clearTimeout(draftTimer.current), [])

  function commit(e: Editor) {
    onCommit(e.getJSON() as DocJSON)
  }

  useEffect(() => {
    if (!editor) return
    onReady?.(editor)
    // Focus as soon as the view is in the document. EditorContent (a child) attaches it before this
    // effect runs, so usually that is immediately; otherwise wait a frame or two. Keys typed right after
    // the click must land in the editor, so never defer when not needed.
    // Single paragraph: document position = text offset + 1 (the paragraph's opening token).
    let tries = 0
    let raf = 0
    const place = () => {
      if (editor.isDestroyed) return
      if (!editor.view.dom.isConnected) {
        if (tries++ < 10) raf = requestAnimationFrame(place)
        return
      }
      if (selectAll) { editor.commands.focus("all"); return }
      if (caretOffset == null) { editor.commands.focus("end"); return }
      const max = editor.state.doc.content.size - 1
      editor.commands.focus(Math.max(1, Math.min(caretOffset + 1, max)))
    }
    place()
    return () => cancelAnimationFrame(raf)
  }, [editor, onReady, caretOffset, selectAll])

  return <EditorContent editor={editor} />
}
