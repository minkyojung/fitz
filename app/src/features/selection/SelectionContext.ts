import { createContext, useContext } from "react"

import type { TextSelection } from "@/lib/selection"

export interface SelectionState {
  selection: TextSelection | null
  /** Adapters publish here; `null` clears. */
  publish: (sel: TextSelection | null) => void
}

export const SelectionContext = createContext<SelectionState | null>(null)
export const useSelectionState = () => useContext(SelectionContext)
