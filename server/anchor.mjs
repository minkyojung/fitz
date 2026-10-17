/** Text anchors in the W3C Web Annotation style: the quoted text plus a little context on each side,
 *  and the offsets it had when created. Re-locating tries the offsets first, then the quote with context,
 *  then the quote alone; it gives up (null) rather than guess.
 *  Same algorithm as app/src/lib/anchor.ts; keep the two in step (anchor.test.mjs mirrors anchor.test.ts). */

export function makeAnchor(text, start, end, context = 32) {
  return { exact: text.slice(start, end), prefix: text.slice(Math.max(0, start - context), start), suffix: text.slice(end, end + context), start, end }
}

export function locateAnchor(text, a) {
  if (!a.exact) return null
  if (text.slice(a.start, a.end) === a.exact) return { start: a.start, end: a.end }
  // every occurrence of the quote; prefer the one whose surroundings match best, then the nearest to the old offset
  const candidates = []
  for (let i = text.indexOf(a.exact); i !== -1; i = text.indexOf(a.exact, i + 1)) candidates.push(i)
  if (!candidates.length) return null
  const score = (i) => {
    const before = text.slice(Math.max(0, i - a.prefix.length), i)
    const after = text.slice(i + a.exact.length, i + a.exact.length + a.suffix.length)
    return commonSuffix(before, a.prefix) + commonPrefix(after, a.suffix) - Math.abs(i - a.start) / 1000
  }
  const best = candidates.reduce((b, i) => (score(i) > score(b) ? i : b))
  return { start: best, end: best + a.exact.length }
}

const commonPrefix = (a, b) => { let n = 0; while (n < a.length && n < b.length && a[n] === b[n]) n++; return n }
const commonSuffix = (a, b) => { let n = 0; while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++; return n }
