/** OCR confusions: what the engine printed → what was on the page, with a weight for how common that error is.
 *  Applied one substitution at a time to generate correction candidates. */

export const CONFUSIONS: [seen: string, meant: string, weight: number][] = [
  ["T", "I", 0.9], ["l", "I", 0.9], ["1", "l", 0.6], ["1", "I", 0.6], ["I", "l", 0.5], ["|", "l", 0.6],
  ["rn", "m", 0.8], ["m", "rn", 0.3], ["ri", "n", 0.4], ["ii", "n", 0.3], ["vv", "w", 0.5], ["cl", "d", 0.4],
  ["f", "r", 0.5], ["r", "f", 0.3], ["t", "f", 0.4], ["f", "t", 0.4], ["c", "e", 0.5], ["e", "c", 0.5],
  ["o", "0", 0.2], ["0", "o", 0.5], ["h", "b", 0.4], ["b", "h", 0.4], ["a", "o", 0.4], ["u", "n", 0.4], ["n", "u", 0.4],
  ["fi", "fl", 0.3], ["fl", "fi", 0.3], ["ñ", "fi", 0.2], ["fi", "ñ", 0.6], ["é", "e", 0.4], ["e", "é", 0.2],
  ["S", "5", 0.2], ["5", "S", 0.4], ["B", "8", 0.2], ["8", "B", 0.4], ["Z", "2", 0.2], ["2", "Z", 0.3],
]

export interface Candidate {
  word: string
  /** Error-model weight: how plausible it is that `word` was misread as the original. 0 = not from the table. */
  weight: number
}

/** All single-substitution candidates from the confusion table (deduplicated, best weight kept). */
export function confusionCandidates(word: string): Candidate[] {
  const best = new Map<string, number>()
  for (const [seen, meant, weight] of CONFUSIONS) {
    let from = word.indexOf(seen)
    while (from !== -1) {
      const cand = word.slice(0, from) + meant + word.slice(from + seen.length)
      if (cand !== word) best.set(cand, Math.max(best.get(cand) ?? 0, weight))
      from = word.indexOf(seen, from + 1)
    }
  }
  return [...best].map(([w, weight]) => ({ word: w, weight }))
}
