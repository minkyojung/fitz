import { createContext, useContext } from "react"

import type { Annotations, TextAnchor } from "@/data/api"

export type Selected = { kind: "comment" | "note"; id: number } | null

export interface AnnotationState {
  annotations: Annotations
  /** Selected item, for cross-highlighting between text and panel. */
  selected: Selected
  select: (sel: Selected) => void
  /** Footnote labels by note id for the current chapter (author numbers, translator asterisks). */
  markers: Map<number, string>
  actions: {
    addComment: (segmentId: number, side: "source" | "target", anchor: TextAnchor | null, body: string, parentId?: number | null) => Promise<unknown>
    setComment: (id: number, patch: { body?: string; resolved?: boolean }) => Promise<unknown>
    deleteComment: (id: number) => Promise<unknown>
    addNote: (segmentId: number, anchor: TextAnchor | null, body: string) => Promise<unknown>
    setNote: (id: number, patch: { body?: string; targetAnchor?: TextAnchor | null }) => Promise<unknown>
    deleteNote: (id: number) => Promise<unknown>
  }
}

export const AnnotationsContext = createContext<AnnotationState | null>(null)
export const useAnnotations = () => useContext(AnnotationsContext)
