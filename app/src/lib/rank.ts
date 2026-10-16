/** Noisy-channel ranking of correction candidates:
 *  score = error model (confusion weight, or a small floor for dictionary-shape candidates)
 *        × language model (how often the candidate, and its pairs with the neighbours, occur in this book). */

import { confusionCandidates } from "./confusions.ts"
import { pairCount, wordCount, type Corpus } from "./corpus.ts"

export interface Ranked {
  word: string
  score: number
}

const HUNSPELL_FLOOR = 0.15 // a dictionary candidate with no confusion evidence
const BIGRAM_WEIGHT = 3

export function rankCandidates(
  word: string,
  context: { prev?: string; next?: string },
  hunspellSuggest: (w: string) => string[],
  correct: (w: string) => boolean,
  corpus: Corpus,
  limit = 5,
): Ranked[] {
  const scores = new Map<string, number>()
  const consider = (cand: string, errorWeight: number) => {
    if (cand === word) return
    if (!correct(cand) && !correct(cand.toLowerCase())) return // only real words survive
    const lm =
      (1 + wordCount(corpus, cand)) *
      (1 + BIGRAM_WEIGHT * (context.prev ? pairCount(corpus, context.prev, cand) : 0)) *
      (1 + BIGRAM_WEIGHT * (context.next ? pairCount(corpus, cand, context.next) : 0))
    const score = errorWeight * lm
    if (score > (scores.get(cand) ?? 0)) scores.set(cand, score)
  }
  for (const c of confusionCandidates(word)) consider(c.word, c.weight)
  for (const s of hunspellSuggest(word)) consider(s, HUNSPELL_FLOOR)
  return [...scores].map(([w, score]) => ({ word: w, score })).sort((a, b) => b.score - a.score).slice(0, limit)
}

/** Neighbouring words of a span inside `text`. */
export function neighbours(text: string, start: number, end: number): { prev?: string; next?: string } {
  const before = text.slice(0, start).match(/([A-Za-z’']+)[^A-Za-z]*$/)
  const after = text.slice(end).match(/^[^A-Za-z]*([A-Za-z’']+)/)
  return { prev: before?.[1], next: after?.[1] }
}
