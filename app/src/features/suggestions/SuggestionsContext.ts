import { createContext, useContext } from "react"

import type { Suggestion } from "@/data/api"

/** Claude's open suggestions on the chapter that the current view shows (the review's on the translation, the OCR
 *  hunt's on the source), and the one selected — in the text or in the panel, the way a comment is. */
export interface SuggestionState {
  suggestions: Suggestion[]
  selected: number | null
  select: (id: number | null) => void
}

export const SuggestionsContext = createContext<SuggestionState | null>(null)
export const useSuggestions = () => useContext(SuggestionsContext)
