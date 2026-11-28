import type { Doc } from "@shared/protocol.ts"

/** The text as the database holds it: one block per paragraph, italic where it is marked. */
export function DocText({ doc }: { doc: Doc }) {
  return doc.content.map((paragraph, i) => (
    <p key={i}>
      {(paragraph.content ?? []).map((node, j) =>
        node.marks?.some((mark) => mark.type === "italic") ? <em key={j}>{node.text}</em> : node.text,
      )}
    </p>
  ))
}
