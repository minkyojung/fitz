import { Extension } from "@tiptap/core"
import Document from "@tiptap/extension-document"
import Italic from "@tiptap/extension-italic"
import Paragraph from "@tiptap/extension-paragraph"
import Text from "@tiptap/extension-text"
import { UndoRedo } from "@tiptap/extensions"
import { EditorContent, useEditor, type Editor } from "@tiptap/react"
import { useEffect, useImperativeHandle, useRef, type Ref } from "react"

import { Doc } from "@shared/protocol.ts"

/** How an edit ended: the focus went elsewhere, a key said where to go next, or the paragraph is to be cut at the caret. */
export type Leave = "blur" | "done" | "next" | "previous" | "confirm" | "split"

/** What can be asked of an open editor from outside it. */
export interface EditorHandle {
  /** End the edit, to cut the paragraph where the caret is. */
  split(): void
}

/** How long typing rests before what was typed is handed on to be kept as a draft. */
const DRAFT_DELAY = 300

/** The caret as an offset into the text: a paragraph costs one position to open and one to close. */
function textOffset(editor: Editor): number {
  const at = editor.state.selection.from
  let offset = 0
  editor.state.doc.nodesBetween(0, at, (node, pos) => {
    if (node.isText) offset += Math.min(at, pos + node.nodeSize) - pos
    return true
  })
  return offset
}

/** A translation is one or more paragraphs of text, as the book stores it: nothing else can be typed into it. */
const Paragraphs = Document.extend({ content: "paragraph+" })
/** A source is exactly one paragraph: the schema cannot hold a second, so Enter means "done". */
const OneParagraph = Document.extend({ content: "paragraph" })

/** One side of a paragraph being edited in place: a translation (paragraphs; Enter makes a new one, ⌘Enter confirms)
 *  or a source (`single`: one paragraph; Enter and ⌘Enter are done). It holds the text while it is open and hands it
 *  over once, when it is left; saving is the caller's. ⌘Z here takes back typing — the book's own undo is outside. */
export function SegmentEditor({ ref, doc, caret, className, lang, single = false, onLeave, onCancel, onDraft }: {
  ref?: Ref<EditorHandle>
  doc: Doc
  lang: "en" | "ko"
  /** One paragraph only. */
  single?: boolean
  /** Where the caret starts: a position in the document, its end, or all of the text chosen (to be typed over). */
  caret: number | "end" | "all"
  /** The read view's classes, so nothing shifts when the editor takes its place. */
  className: string
  /** The edit ended with this text; `caret` is where the caret was in it (a text offset). Called once. */
  onLeave: (doc: Doc, how: Leave, caret: number) => void
  /** Escape: the edit ended and its text is dropped. Called once. */
  onCancel: () => void
  /** The text as it stands, a moment after typing rests: for keeping as a draft. Never called once the edit has ended. */
  onDraft: (doc: Doc) => void
}) {
  // an edit ends once: the blur that follows a key that already ended it says nothing more
  const left = useRef(false)
  const draftTimer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(draftTimer.current), [])
  const editor = useEditor({
    extensions: [
      single ? OneParagraph : Paragraphs,
      Paragraph,
      Text,
      Italic,
      UndoRedo,
      Extension.create({
        name: "leaveKeys",
        addKeyboardShortcuts() {
          const leave = (how: Leave) => () => {
            if (left.current) return true
            left.current = true
            window.clearTimeout(draftTimer.current)
            onLeave(Doc.parse(this.editor.getJSON()), how, textOffset(this.editor))
            return true
          }
          return {
            Tab: leave("next"),
            "Shift-Tab": leave("previous"),
            "Mod-Enter": leave(single ? "done" : "confirm"),
            ...(single ? { Enter: leave("done") } : {}),
            Escape: () => {
              if (!left.current) {
                left.current = true
                window.clearTimeout(draftTimer.current)
                onCancel()
              }
              return true
            },
          }
        },
      }),
    ],
    content: doc,
    autofocus: caret,
    editorProps: { attributes: { class: className, lang, "aria-label": lang === "ko" ? "Edit translation" : "Edit paragraph", spellcheck: "false" } },
    onUpdate: ({ editor }) => {
      window.clearTimeout(draftTimer.current)
      draftTimer.current = window.setTimeout(() => {
        if (!left.current) onDraft(Doc.parse(editor.getJSON()))
      }, DRAFT_DELAY)
    },
    onBlur: ({ editor }) => {
      if (left.current) return
      left.current = true
      window.clearTimeout(draftTimer.current)
      onLeave(Doc.parse(editor.getJSON()), "blur", textOffset(editor))
    },
  })
  useImperativeHandle(ref, () => ({
    split() {
      if (!editor || left.current) return
      left.current = true
      window.clearTimeout(draftTimer.current)
      onLeave(Doc.parse(editor.getJSON()), "split", textOffset(editor))
    },
  }), [editor, onLeave])
  return <EditorContent editor={editor} />
}
