import { createContext, useContext } from "react"

import type { DraftStore } from "@/lib/draftStore"

/** The draft store for the open book; null until the book is known. */
export const DraftContext = createContext<DraftStore | null>(null)
export const useDrafts = () => useContext(DraftContext)
