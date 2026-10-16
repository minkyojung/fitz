/** Spell suspects: words the dictionary cannot form. Pure over a `correct` predicate so it is testable
 *  without a dictionary; the real dictionary is Hunspell (en_US) via nspell, loaded once per session. */

export interface Suspect {
  start: number
  end: number
  word: string
}

export type Checker = (word: string) => boolean

/** Words with letters only (apostrophes inside allowed). Numbers, all-caps acronyms and single letters are skipped. */
const WORD = /[A-Za-z][A-Za-z’']*[A-Za-z]|[A-Za-z]/g

export function findSuspects(text: string, correct: Checker, userWords: ReadonlySet<string> = new Set()): Suspect[] {
  const out: Suspect[] = []
  for (const m of text.matchAll(WORD)) {
    const raw = m[0]
    const word = raw.replace(/’/g, "'")
    if (word.length < 2) continue
    if (/^[A-Z]{2,}$/.test(word)) continue // acronym
    if (userWords.has(word) || userWords.has(word.toLowerCase())) continue
    if (correct(word)) continue
    // capitalised at a sentence start: accept if the lowercase form is a word
    if (/^[A-Z]/.test(word) && correct(word.toLowerCase())) continue
    out.push({ start: m.index!, end: m.index! + raw.length, word: raw })
  }
  return out
}

let loading: Promise<Checker> | null = null

/** Hunspell en_US, loaded lazily once. The dictionary files ship with the app (no network). */
export function loadEnglishChecker(): Promise<Checker> {
  loading ??= Promise.all([
    import("nspell"),
    // relative file paths bypass the package's `exports` map, which does not expose the raw files
    import("../../node_modules/dictionary-en/index.aff?raw"),
    import("../../node_modules/dictionary-en/index.dic?raw"),
  ]).then(([{ default: nspell }, aff, dic]) => {
    const d = nspell(aff.default, dic.default)
    return (w) => d.correct(w)
  })
  return loading
}
