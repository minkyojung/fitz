import { diffWords } from "diff"

export type Piece = { text: string; kind: "same" | "added" | "removed" }

/** Word-level diff between the OCR original and the current text. Pure; used by SourceText and tests. */
export function diffText(original: string, current: string): Piece[] {
  return diffWords(original, current).map((c) => ({
    text: c.value,
    kind: c.added ? "added" : c.removed ? "removed" : "same",
  }))
}

export const isChanged = (pieces: Piece[]) => pieces.some((p) => p.kind !== "same")
