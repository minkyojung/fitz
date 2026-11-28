/** A piece of a word-by-word comparison: kept in both, only in the old text, or only in the new. */
export interface DiffPart {
  kind: "same" | "del" | "ins"
  text: string
}

/** What changed from `before` to `after`, word by word: the longest run of words the two share is kept, the rest is
 *  taken out of `before` or put into `after`. Spaces stay with the words they follow, so the parts read as the text. */
export function diffWords(before: string, after: string): DiffPart[] {
  const a = before.match(/\S+\s*|\s+/g) ?? []
  const b = after.match(/\S+\s*|\s+/g) ?? []
  // a word and the spaces after it are compared as the word alone: a changed space is not a changed word
  const same = (x: string, y: string) => x.trimEnd() === y.trimEnd()
  // lengths of the longest common runs of a[i…] and b[j…]
  const n = a.length
  const m = b.length
  const lcs = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1))
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--) lcs[i]![j] = same(a[i]!, b[j]!) ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!)

  const parts: DiffPart[] = []
  const push = (kind: DiffPart["kind"], text: string) => {
    const last = parts.at(-1)
    if (last?.kind === kind) last.text += text
    else parts.push({ kind, text })
  }
  let i = 0
  let j = 0
  while (i < n || j < m) {
    if (i < n && j < m && same(a[i]!, b[j]!)) {
      push("same", b[j]!)
      i++
      j++
    } else if (j < m && (i === n || lcs[i]![j + 1]! >= lcs[i + 1]![j]!)) {
      push("ins", b[j++]!)
    } else {
      push("del", a[i++]!)
    }
  }
  return parts
}
