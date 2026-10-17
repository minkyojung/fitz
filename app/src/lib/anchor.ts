/** Text anchors in the W3C Web Annotation style: the quoted text plus a little context on each side,
 *  and the offsets it had when created. Re-locating tries the offsets first, then the quote with context,
 *  then the quote alone; it gives up (null) rather than guess.
 *  The server has the same algorithm in server/anchor.mjs (export needs it); keep the two in step. */

export interface Anchor {
  exact: string
  prefix: string
  suffix: string
  start: number
  end: number
}

const CONTEXT = 32

export function makeAnchor(text: string, start: number, end: number): Anchor {
  return { exact: text.slice(start, end), prefix: text.slice(Math.max(0, start - CONTEXT), start), suffix: text.slice(end, end + CONTEXT), start, end }
}

export function locateAnchor(text: string, a: Anchor): { start: number; end: number } | null {
  if (!a.exact) return null
  if (text.slice(a.start, a.end) === a.exact) return { start: a.start, end: a.end }
  // every occurrence of the quote; prefer the one whose surroundings match best, then the nearest to the old offset
  const candidates: number[] = []
  for (let i = text.indexOf(a.exact); i !== -1; i = text.indexOf(a.exact, i + 1)) candidates.push(i)
  if (!candidates.length) return null
  const score = (i: number) => {
    const before = text.slice(Math.max(0, i - a.prefix.length), i)
    const after = text.slice(i + a.exact.length, i + a.exact.length + a.suffix.length)
    return commonSuffix(before, a.prefix) + commonPrefix(after, a.suffix) - Math.abs(i - a.start) / 1000
  }
  const best = candidates.reduce((b, i) => (score(i) > score(b) ? i : b))
  return { start: best, end: best + a.exact.length }
}

const commonPrefix = (a: string, b: string) => { let n = 0; while (n < a.length && n < b.length && a[n] === b[n]) n++; return n }
const commonSuffix = (a: string, b: string) => { let n = 0; while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++; return n }
