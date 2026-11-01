import { createContext, useContext } from "react"

import type { Relation } from "@/data/api"

/** The book's relations (docs/relations.md), for the graph, the paragraphs' marks and the selection toolbar. */
export interface RelationState {
  relations: Relation[]
  /** The paragraph selected in the text: the graph lights the relations resting on it. */
  selectedSegmentId: number | null
  /** Open the reference column on the Relations tab. */
  show: () => void
  actions: {
    add: (input: { fromTerm: string; toTerm: string; label: string; segmentId: number; quote: string | null }) => Promise<unknown>
    remove: (id: number) => Promise<unknown>
  }
}

export const RelationsContext = createContext<RelationState | null>(null)
export const useRelations = () => useContext(RelationsContext)
