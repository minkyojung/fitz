/** Data interface the UI depends on. Implementations: http.ts (dev server), later a Tauri binding. */

/** ProseMirror document JSON: paragraphs of text nodes with optional marks.
 *  Source docs hold exactly one paragraph; a translation may hold several (blocks inside one pair). */
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
  /** Segments whose translation is reviewed or final. */
  confirmedCount: number
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
  /** Translation; null until written. Plain text joins paragraphs with newlines. */
  targetDoc: DocJSON | null
  targetText: string
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

export interface SearchHit {
  segmentId: number
  chapterId: number
  chapterTitle: string
  pageStart: number
  count: number
  snippet: string
}

export interface SegmentPatch {
  sourceText?: string
  /** Wins over sourceText; the server derives the text from it so marks survive. */
  sourceDoc?: DocJSON
  /** null clears the translation. First translation moves status to draft automatically. */
  targetDoc?: DocJSON | null
  status?: SegmentStatus
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
  /** Words the person marked as correct for this book. */
  listGlossaryWords(bookId: number): Promise<string[]>
  addGlossaryWord(bookId: number, term: string): Promise<{ id: number; term: string }>
  /** Every segment's plain text (for the client-side language model). */
  listSourceTexts(): Promise<{ id: number; text: string }[]>
  /** Literal, case-sensitive search across the whole book. */
  search(query: string): Promise<SearchHit[]>
  /** Replace every occurrence in the book as one undoable step. */
  replaceAll(query: string, replacement: string): Promise<{ segments: number; occurrences: number }>
}
