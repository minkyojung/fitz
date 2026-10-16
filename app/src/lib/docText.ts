/** Edit a single-paragraph ProseMirror doc by text offsets, keeping marks on untouched text.
 *  Used to accept a spelling fix without opening the editor. */

import type { DocJSON } from "@/data/api"

type TextNode = { type: "text"; text: string; marks?: Array<{ type: string }> }

export function docPlainText(doc: DocJSON): string {
  return doc.content.map((p) => (p.content ?? []).map((n) => n.text).join("")).join("\n")
}

export const emptyDoc = (): DocJSON => ({ type: "doc", content: [{ type: "paragraph", content: [] }] })

export function replaceRangeInDoc(doc: DocJSON, start: number, end: number, replacement: string): DocJSON {
  const out: TextNode[] = []
  let pos = 0
  let inserted = false
  for (const n of doc.content[0].content ?? []) {
    const nStart = pos
    const nEnd = pos + n.text.length
    pos = nEnd
    if (nEnd <= start || nStart >= end) { out.push({ ...n }); continue } // untouched node
    const head = n.text.slice(0, Math.max(0, start - nStart))
    const tail = n.text.slice(Math.min(n.text.length, end - nStart))
    if (head) out.push({ ...n, text: head })
    if (!inserted) { out.push({ ...n, text: replacement }); inserted = true } // replacement inherits the first touched node's marks
    if (tail) out.push({ ...n, text: tail })
  }
  return { type: "doc", content: [{ type: "paragraph", content: out.filter((n) => n.text !== "") }] }
}
