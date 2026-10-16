/** Data interface the UI depends on. Implementations: http.ts (dev server), later a Tauri binding. */

export type SegmentKind = "paragraph" | "heading" | "blockquote" | "caption" | "verse"
export type SegmentStatus = "untranslated" | "draft" | "reviewed" | "final"

export interface Chapter {
  id: number
  idx: number
  title: string
  startPage: number | null
  segmentCount: number
  verifiedCount: number
}

export interface Segment {
  id: number
  chapterId: number
  idx: number
  kind: SegmentKind
  pageStart: number
  pageEnd: number
  sourceText: string
  verified: boolean
  status: SegmentStatus
}

export interface Page {
  pageNo: number
  pdfIndex: number
  imageUrl: string
}

export interface Note {
  id: number
  segmentId: number
  kind: "author" | "translator"
  origPage: number | null
  origQuote: string | null
  bodySource: string | null
  anchored: boolean
}

export interface SegmentPatch {
  sourceText?: string
  kind?: SegmentKind
  verified?: boolean
}

export interface Api {
  listChapters(): Promise<Chapter[]>
  listSegments(chapterId: number): Promise<Segment[]>
  listPages(): Promise<Page[]>
  updateSegment(id: number, patch: SegmentPatch): Promise<Segment>
  /** Split at a character offset of sourceText. Returns [head, tail]. */
  splitSegment(id: number, offset: number): Promise<[Segment, Segment]>
  /** Merge a segment with the one that follows it in the same chapter. */
  mergeWithNext(id: number): Promise<Segment>
  listUnanchoredNotes(): Promise<Note[]>
  anchorNote(noteId: number, segmentId: number): Promise<Note>
}
