import { useEffect } from "react"
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
  /** Called with the edited doc. The caller persists it. */
  onCommit: (doc: DocJSON) => void
  onCancel: () => void
  onReady?: (editor: Editor) => void
}

/** Text offset of the caret inside the single paragraph (position 0 is the paragraph's opening token). */
export const caretOffset = (editor: Editor) => editor.state.selection.from - 1

/** In-place paragraph editor. Same `.reading` classes as the read view, so nothing shifts when it mounts. */
export function SegmentEditor({ doc, className, caretOffset, onCommit, onCancel, onReady }: Props) {
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
          }
        },
      }),
    ],
    content: doc,
    editorProps: {
      attributes: { class: className ?? "", lang: "en", "aria-label": "단락 편집" },
    },
    onBlur: ({ editor }) => commit(editor),
  })

  function commit(e: Editor) {
    onCommit(e.getJSON() as DocJSON)
  }

  useEffect(() => {
    if (!editor) return
    onReady?.(editor)
    // Focus once the view is in the document (EditorContent attaches it after this effect).
    // Single paragraph: document position = text offset + 1 (the paragraph's opening token).
    let tries = 0
    let raf = 0
    const place = () => {
      if (editor.isDestroyed) return
      if (!editor.view.dom.isConnected && tries++ < 10) { raf = requestAnimationFrame(place); return }
      if (caretOffset == null) { editor.commands.focus("end"); return }
      const max = editor.state.doc.content.size - 1
      editor.commands.focus(Math.max(1, Math.min(caretOffset + 1, max)))
    }
    raf = requestAnimationFrame(place)
    return () => cancelAnimationFrame(raf)
  }, [editor, onReady, caretOffset])

  return <EditorContent editor={editor} />
}
