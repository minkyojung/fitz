import { createContext, useContext } from "react"

import type { Corpus } from "@/lib/corpus"
import type { Speller } from "@/lib/spell"

export interface SpellState {
  /** null until the Hunspell dictionary has loaded. */
  speller: Speller | null
  corpus: Corpus
  userWords: ReadonlySet<string>
  addWord: (term: string) => Promise<unknown>
}

export const SpellContext = createContext<SpellState | null>(null)
export const useSpell = () => useContext(SpellContext)
