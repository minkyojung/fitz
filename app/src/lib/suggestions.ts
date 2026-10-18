/** Claude's suggestions laid on a paragraph's text (docs/agent.md §4). Each points at the one place its quote is, found
 *  the way the server finds it when the translator accepts; one that no longer fits the text is not laid. Pure. */

/** Where the quote is in the text, if it is there exactly once; -1 otherwise. */
export function findOnce(text: string, quote: string): number {
  const at = quote ? text.indexOf(quote) : -1
  return at !== -1 && text.indexOf(quote, at + 1) === -1 ? at : -1
}

export interface Placed<T> { start: number; end: number; item: T }

/** In text order. One whose quote is not in the text exactly once is left out, and so is one that overlaps one
 *  laid before it. */
export function placeSuggestions<T extends { quote: string }>(text: string, items: T[]): Placed<T>[] {
  const found = items
    .map((item) => ({ start: findOnce(text, item.quote), item }))
    .filter((p) => p.start !== -1)
    .map((p) => ({ ...p, end: p.start + p.item.quote.length }))
    .sort((a, b) => a.start - b.start)
  const laid: Placed<T>[] = []
  for (const p of found) if (!laid.length || laid[laid.length - 1].end <= p.start) laid.push(p)
  return laid
}

/** The placed ones that lie inside [from, to), with offsets from `from`: for a paragraph shown block by block. */
export const within = <T,>(placed: Placed<T>[], from: number, to: number): Placed<T>[] =>
  placed.filter((p) => p.start >= from && p.end <= to).map((p) => ({ ...p, start: p.start - from, end: p.end - from }))
