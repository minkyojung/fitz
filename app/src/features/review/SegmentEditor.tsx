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
  /** Called with the edited doc. The caller persists it. */
  onCommit: (doc: DocJSON) => void
  onCancel: () => void
  onReady?: (editor: Editor) => void
}

/** Text offset of the caret inside the single paragraph (position 0 is the paragraph's opening token). */
export const caretOffset = (editor: Editor) => editor.state.selection.from - 1

/** In-place paragraph editor. Same `.reading` classes as the read view, so nothing shifts when it mounts. */
export function SegmentEditor({ doc, className, onCommit, onCancel, onReady }: Props) {
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
    autofocus: "end",
    editorProps: {
      attributes: { class: className ?? "", lang: "en", "aria-label": "단락 편집" },
    },
    onBlur: ({ editor }) => commit(editor),
  })

  function commit(e: Editor) {
    onCommit(e.getJSON() as DocJSON)
  }

  useEffect(() => {
    if (editor) onReady?.(editor)
  }, [editor, onReady])

  return <EditorContent editor={editor} />
}
