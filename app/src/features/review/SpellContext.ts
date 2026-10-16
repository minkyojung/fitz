import { createContext, useContext } from "react"

import type { Corpus } from "@/lib/corpus"
import type { Speller } from "@/lib/spell"
import type { GlossaryTerm } from "@/data/api"

export interface SpellState {
  /** null until the Hunspell dictionary has loaded. */
  speller: Speller | null
  corpus: Corpus
  userWords: ReadonlySet<string>
  addWord: (term: string) => Promise<unknown>
  glossary: GlossaryTerm[]
  setTerm: (input: { term: string; translation: string; aliases: string; kind: GlossaryTerm["kind"] }) => Promise<unknown>
}

export const SpellContext = createContext<SpellState | null>(null)
export const useSpell = () => useContext(SpellContext)
