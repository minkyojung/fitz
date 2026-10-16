/** Glossary matching: where terms occur in a source paragraph, and whether the translation uses the agreed form.
 *  Pure functions; nothing is stored, everything is recomputed from the text and the glossary. */

export interface GlossaryEntry {
  id: number
  term: string
  translation: string
  /** Comma-separated accepted variants, e.g. "샘 제무레이, 제무레이 씨". */
  aliases: string
  kind: "person" | "place" | "org" | "work" | "other"
  occurrences?: number
}

export interface TermHit {
  start: number
  end: number
  entry: GlossaryEntry
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

/** Whole-word, case-insensitive, allowing a possessive or plural tail (Zemurray's, Keiths). Longest terms win overlaps. */
export function findTerms(text: string, glossary: GlossaryEntry[]): TermHit[] {
  const hits: TermHit[] = []
  for (const entry of glossary) {
    if (!entry.term.trim()) continue
    const re = new RegExp(`(?<![A-Za-z])${escape(entry.term)}(?:[’']s|s)?(?![A-Za-z])`, "gi")
    for (const m of text.matchAll(re)) hits.push({ start: m.index!, end: m.index! + m[0].length, entry })
  }
  hits.sort((a, b) => a.start - b.start || b.end - a.end)
  const out: TermHit[] = []
  let last = -1
  for (const h of hits) if (h.start >= last) { out.push(h); last = h.end }
  return out
}

export const acceptedForms = (e: GlossaryEntry) =>
  [e.translation, ...e.aliases.split(",")].map((s) => s.trim()).filter(Boolean)

/** Terms present in the source whose agreed translation (or an alias) is missing from the target.
 *  Entries without a translation yet are not checked. Korean particles attach to words, so a substring match is right. */
export function missingTerms(sourceHits: TermHit[], target: string, hasTarget = target.trim().length > 0): GlossaryEntry[] {
  if (!hasTarget) return []
  const seen = new Set<number>()
  const out: GlossaryEntry[] = []
  for (const h of sourceHits) {
    const e = h.entry
    if (seen.has(e.id) || !e.translation.trim()) continue
    seen.add(e.id)
    if (!acceptedForms(e).some((f) => target.includes(f))) out.push(e)
  }
  return out
}
