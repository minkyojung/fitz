import { diffWords } from "diff"

export type Piece = { text: string; kind: "same" | "added" | "removed" }

// jsdiff's own word rule knows Latin letters only, so Korean fell apart letter by letter; the platform's word
// segmenter knows both languages
const WORDS = new Intl.Segmenter(undefined, { granularity: "word" })

/** Word-level diff between the OCR original and the current text. Pure; used by SourceText and tests.
 *  Edge whitespace of changed pieces is pushed out into neighbouring "same" pieces so highlights hug the words. */
export function diffText(original: string, current: string): Piece[] {
  const raw: Piece[] = diffWords(original, current, { intlSegmenter: WORDS }).map((c) => ({
    text: c.value,
    kind: c.added ? "added" : c.removed ? "removed" : "same",
  }))
  const out: Piece[] = []
  const pushSame = (text: string) => {
    if (!text) return
    const last = out[out.length - 1]
    if (last?.kind === "same") last.text += text
    else out.push({ text, kind: "same" })
  }
  for (const p of raw) {
    if (p.kind === "same") { pushSame(p.text); continue }
    const lead = p.text.match(/^\s*/)![0]
    const trail = p.text.match(/\s*$/)![0]
    const core = p.text.slice(lead.length, p.text.length - trail.length)
    pushSame(lead)
    if (core) out.push({ text: core, kind: p.kind })
    pushSame(trail)
  }
  return out
}

export const isChanged = (pieces: Piece[]) => pieces.some((p) => p.kind !== "same")
