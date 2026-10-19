// The glossary rule, in one place for the server and the editor's page (the page imports this file, as it does
// fold.mjs): where a term occurs in English, and whether a translation uses its agreed Korean form. The editor's
// warning and the checks on Claude's translations (checks.mjs) can therefore never disagree. Pure.

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

/** A term as a whole word, case-insensitive, allowing a possessive or plural tail (Zemurray's, Keiths). */
export const termPattern = (term, flags = "i") => new RegExp(`(?<![A-Za-z])${escape(term)}(?:[’']s|s)?(?![A-Za-z])`, flags)

/** The Korean forms a translation may use for an entry: its translation, then its aliases. */
export const acceptedForms = (entry) => [entry.translation, ...(entry.aliases ?? "").split(",")].map((s) => s.trim()).filter(Boolean)

/** Of the entries whose term occurs in the source, those none of whose accepted forms is in the translation. Entries
 *  without a translation yet are not checked; nor is a paragraph with no translation. Korean particles attach to
 *  words, so a substring match is right. */
export function missingForms(entries, target) {
  if (!target.trim()) return []
  const seen = new Set()
  return entries.filter((e) => {
    if (seen.has(e.term) || !e.translation.trim()) return false
    seen.add(e.term)
    return !acceptedForms(e).some((f) => target.includes(f))
  })
}
