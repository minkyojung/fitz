/** Data interface the UI depends on. Implementations: http.ts (dev server), later a Tauri binding. */

/** ProseMirror document JSON (single paragraph of text nodes, optional marks). */
export type DocJSON = { type: "doc"; content: Array<{ type: "paragraph"; content?: Array<{ type: "text"; text: string; marks?: Array<{ type: string }> }> }> }

export type SegmentKind = "paragraph" | "heading" | "blockquote" | "caption" | "verse"
export type SegmentStatus = "untranslated" | "draft" | "reviewed" | "final"

export interface Book {
  id: number
  title: string
  author: string | null
}

export interface Chapter {
  id: number
  idx: number
  title: string
  startPage: number | null
  segmentCount: number
  verifiedCount: number
}

/** Where a segment sits on a scanned page, as fractions of the page (0..1). One per page it touches. */
export interface Box {
  pageNo: number
  x0: number
  y0: number
  x1: number
  y1: number
}

export interface Segment {
  id: number
  chapterId: number
  idx: number
  kind: SegmentKind
  pageStart: number
  pageEnd: number
  sourceText: string
  sourceDoc: DocJSON
  /** OCR original, immutable. null when the row was edited before originals were kept. */
  ocrText: string | null
  boxes: Box[]
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
  /** Wins over sourceText; the server derives the text from it so marks survive. */
  sourceDoc?: DocJSON
  kind?: SegmentKind
  verified?: boolean
}

export interface OpSummary {
  id: number
  name: string
  segmentIds: number[]
}

export interface OpRecord extends OpSummary {
  undone: boolean
  createdAt: string
  /** Text before/after, only for text edits. */
  before: string | null
  after: string | null
}

export interface Api {
  getBook(): Promise<Book>
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
  /** New editor-created segment after `afterIdx` in the chapter (-1 = first). */
  insertSegment(input: { chapterId: number; afterIdx: number; kind: SegmentKind; text: string; pageNo: number }): Promise<Segment>
  /** Revert / re-apply the last logged command. null when there is nothing to do. */
  undo(): Promise<OpSummary | null>
  redo(): Promise<OpSummary | null>
  listOps(segmentId: number): Promise<OpRecord[]>
}
