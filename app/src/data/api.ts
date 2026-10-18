/** Data interface the UI depends on. Implementations: http.ts (dev server), later a Tauri binding. */
import type { TaskRun } from "@/lib/taskRun"

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
  /** Raised by the database on every change of content. A save names the version it was based on (expectVersion). */
  version: number
}

export interface Page {
  pageNo: number
  pdfIndex: number
  imageUrl: string
}

/** Text anchor: the quote plus context and the offsets it had when created (see lib/anchor.ts). */
export interface TextAnchor {
  exact: string
  prefix: string
  suffix: string
  start: number
  end: number
}

export interface Note {
  id: number
  segmentId: number
  kind: "author" | "translator"
  origPage: number | null
  origQuote: string | null
  /** Author's note text (as printed in the source book). */
  bodySource: string | null
  /** Translated author's note, or the translator's note itself. */
  bodyTarget: string
  anchored: boolean
  sourceAnchor: TextAnchor | null
  /** Where the footnote number sits in the translation; null until placed. */
  targetAnchor: TextAnchor | null
  createdAt: string
}

export interface Comment {
  id: number
  segmentId: number
  side: "source" | "target"
  parentId: number | null
  body: string
  resolved: boolean
  anchor: TextAnchor | null
  /** The translator, or the translation agent (Claude). */
  author: "translator" | "agent"
  createdAt: string
}

export interface Annotations {
  comments: Comment[]
  notes: Note[]
}

export interface GlossaryTerm {
  id: number
  term: string
  translation: string
  aliases: string
  kind: "person" | "place" | "org" | "work" | "other"
  /** Segments mentioning the term. */
  occurrences: number
  /** First mention in book order, for jumping. */
  first: { segmentId: number; chapterId: number } | null
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
  /** The version this change is based on: if the segment changed since (another window, the agent), nothing is
   *  written and the call fails with status 409. Editors pass the version they started editing from. */
  expectVersion?: number
}

/** A committed write, announced to every open page whoever made it; Claude's new suggestions; "resync" after a
 *  reconnect, when some may have been missed. */
export type BookChange =
  | { kind: "do" | "undo" | "redo"; opId: number; name: string; segmentIds: number[]; actor: OpSummary["actor"] }
  | { kind: "suggested"; segmentIds: number[] }
  | { kind: "resync" }

/** The tasks Claude runs on a chapter (docs/agent.md §4): the review of the translation, the hunt for OCR errors in the source. */
export type TaskName = "review" | "typos"
export type { TaskRun }

/** What Claude found: the quoted words of one paragraph (the translation for a review, the source for OCR errors) and
 *  what should replace them. It stays open until the translator decides it. */
export interface Suggestion {
  id: number
  conversationId: string
  task: TaskName
  segmentId: number
  side: "source" | "target"
  quote: string
  replacement: string
  why: string
  /** The review's: high = the meaning is wrong, medium = unnatural or inconsistent, low = a better choice. */
  level: "high" | "medium" | "low" | null
  /** The paragraph's version when Claude suggested it. */
  baseVersion: number
  status: "open" | "accepted" | "dismissed" | "commented"
  createdAt: string
}
/** accept: the words are replaced; comment: kept as Claude's comment on them; dismiss: let go. ⌘Z undoes each. */
export type SuggestionDecision = "accept" | "dismiss" | "comment"

export interface OpSummary {
  id: number
  name: string
  segmentIds: number[]
  /** Who made the change: the translator (the editor) or the agent (Claude, through a fitz tool). */
  actor: "translator" | "agent"
}

export interface OpRecord extends OpSummary {
  undone: boolean
  createdAt: string
  /** Text before/after, only for text edits. */
  before: string | null
  after: string | null
}

/** Note scheme for export: A = author's notes as endnotes, translator's notes as * footnotes;
 *  B = one numbered series of footnotes; C = one series of endnotes (B and C tag translator's notes "—옮긴이"). */
export type ExportScheme = "A" | "B" | "C"
export interface ExportWarning { kind: "untranslated" | "unplaced" | "untranslatedNote" | "lostAnchor"; chapterId: number; segmentId: number; idx: number; noteId?: number }
export interface ExportSummary {
  chapters: { id: number; idx: number; title: string; segments: number; untranslated: number; unplaced: number; chars: number }[]
  warnings: ExportWarning[]
  stats: { chapters: number; segments: number; untranslated: number; authorNotes: number; translatorNotes: number; unplaced: number; untranslatedNotes: number; chars: number }
  filename: string
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
  listAnnotations(chapterId: number): Promise<Annotations>
  addComment(input: { segmentId: number; side: "source" | "target"; anchor: TextAnchor | null; body: string; parentId?: number | null }): Promise<Comment>
  setComment(input: { id: number; body?: string; resolved?: boolean }): Promise<Comment>
  deleteComment(id: number): Promise<null>
  addNote(input: { segmentId: number; anchor: TextAnchor | null; body: string }): Promise<Note>
  setNote(input: { id: number; body?: string; targetAnchor?: TextAnchor | null }): Promise<Note>
  deleteNote(id: number): Promise<null>
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
  listGlossary(bookId: number): Promise<GlossaryTerm[]>
  setGlossaryTerm(input: { bookId: number; term: string; translation: string; aliases: string; kind: GlossaryTerm["kind"] }): Promise<GlossaryTerm>
  /** Every segment's plain text (for the client-side language model). */
  listSourceTexts(): Promise<{ id: number; text: string }[]>
  /** Literal, case-sensitive search across the whole book. */
  search(query: string): Promise<SearchHit[]>
  /** Replace every occurrence in the book as one undoable step. */
  replaceAll(query: string, replacement: string): Promise<{ segments: number; occurrences: number }>
  /** What an export would contain (chapters omitted = all), and the Word file itself. */
  exportSummary(input: { chapterIds?: number[]; scheme: ExportScheme }): Promise<ExportSummary>
  exportDocx(input: { chapterIds?: number[]; scheme: ExportScheme }): Promise<{ blob: Blob; filename: string }>
  /** Hear every change to the book. Returns the function that stops listening. */
  watchChanges(onChange: (change: BookChange) => void): () => void
  /** Claude's open suggestions on a chapter, in book order. */
  listSuggestions(chapterId: number): Promise<Suggestion[]>
  decideSuggestion(id: number, decision: SuggestionDecision): Promise<Suggestion>
  /** Start Claude on a chapter; `onRun` hears how it goes until it ends. Returns the function that stops following. */
  runTask(task: TaskName, chapterId: number, onRun: (run: TaskRun) => void): () => void
}
