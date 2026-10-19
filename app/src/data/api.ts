/** Data interface the UI depends on. Implementations: http.ts (dev server), later a Tauri binding. */
import type { LiveEvent } from "@/lib/live"
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

/** Session (docs/session.md): a quiz Claude makes every evening from the day's changed paragraphs. A card is asked
 *  without its answer; the server grades it. */
export interface SessionCard {
  id: number
  segmentId: number
  chapterId: number
  /** meaning: what an expression means here; nuance: which Korean is closest to a word's shade. */
  kind: "meaning" | "nuance"
  /** Claude chose it, or the translator picked the words (Add to Session) or asked Claude about them. */
  origin: "claude" | "picked" | "asked"
  /** Never answered before today. */
  isNew: boolean
  /** 1–5: a right answer moves it up and further off (1, 2, 4, 8, 16 days). */
  box: number
  /** Answered wrong today and not yet right: asked again until it is. */
  again: boolean
  quote: string
  /** The sentence of the source the quote is in. */
  sentence: string
  question: string
  options: string[]
}
/** A choice in the translation Claude questions: keep it, use Claude's words instead, or discuss it. */
export interface SessionChallenge {
  id: number
  segmentId: number
  chapterId: number
  /** Who last wrote the paragraph's translation when Claude questioned it. */
  writtenBy: "translator" | "agent"
  quote: string
  proposal: string
  question: string
  why: string
  /** The paragraph's source and translation now. */
  source: string
  translation: string
  /** The words are no longer in the translation exactly once: Claude's words cannot be put in their place. */
  stale: boolean
}
export interface SessionDay {
  /** The server's local day, YYYY-MM-DD. */
  today: string
  /** In the order to ask: reviews due, new cards, then those answered wrong today. */
  cards: SessionCard[]
  challenges: SessionChallenge[]
  /** New cards and challenges beyond today's, for More. */
  waiting: { cards: number; challenges: number }
  evening: {
    /** Claude is making cards now (the evening's run, Try again or Make more). */
    running: boolean
    last: { slot: string; status: "running" | "done" | "failed" | "skipped"; made: number | null; error: string | null; finishedAt: string | null; tries: number } | null
  }
  stats: { learning: number; learned: number; setAside: number }
}
/** What answering a card did: right or not, the right option and why, the paragraph's translation now, and where the
 *  card goes (only the day's first answer moves it). */
export interface CardAnswer {
  id: number
  correct: boolean
  answer: number
  why: string
  translation: string
  first: boolean
  again: boolean
  box: number
  dueOn: string
  status: "active" | "learned"
}

/** A conversation with Claude as book.db lists it (docs/agent.md §13); a task's carries its task and chapter. */
export interface ConversationSummary {
  id: string
  sessionId: string | null
  title: string | null
  model: string
  effort: string
  task: TaskName | null
  chapterId: number | null
  createdAt: string
  usedAt: string
  /** A turn is going on in a live Claude Code (docs/agent.md §23). */
  working: boolean
}
/** What the checks found wrong in a translation Claude wrote (docs/agent.md §19). */
export type CheckFailure =
  | { segmentId: number; kind: "term"; term: string; forms: string[] }
  | { segmentId: number; kind: "note"; noteId: number; noteKind: "author" | "translator"; quote: string }
/** A turn's checks: the paragraphs checked, and what each check found — the last is the verdict, the ones before it
 *  were sent back to Claude. `error` when the checks could not run (never a pass). */
export interface TurnChecks { checked: number[]; rounds: CheckFailure[][]; error?: string }

/** The translator's answer to a write Claude asks for: once, for the rest of the conversation, or not. */
export type AskDecision = "allow" | "always" | "deny"

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
  /** Hear how Claude's task on a chapter goes until it ends: one at work already (the page opened again), or with
   *  `start` one begun now under this new id. Returns the function that stops following. */
  followTask(convId: string, onRun: (run: TaskRun) => void, start?: { task: TaskName; chapterId: number }): () => void
  /** Claude's conversations, most recently used first. */
  listConversations(): Promise<ConversationSummary[]>
  /** Hear a conversation: its snapshot, then its messages, asks and errors; after a reconnect it is followed again. With
   *  `start` the conversation is begun first, under this new id. Returns the function that stops listening. */
  followConversation(convId: string, onEvent: (e: LiveEvent) => void, start?: { model: string; effort: string }): () => void
  sendMessage(convId: string, text: string): void
  stopTurn(convId: string): void
  /** The model or effort a begun conversation's next message goes to; the server tells its followers once it is. */
  configureConversation(convId: string, change: { model?: string; effort?: string }): void
  answerAsk(convId: string, requestId: string, decision: AskDecision): void
  /** Take back Claude's changes made by these tool calls, together, newest first — or none (409, saying why). */
  undoClaude(toolUseIds: string[]): Promise<OpSummary[]>
  /** The change each tool call made, and whether it was taken back. */
  claudeChanges(toolUseIds: string[]): Promise<{ toolUseId: string; opId: number; undone: boolean }[]>
  /** What the checks found in a conversation's turns, by the translator's message that began each. */
  turnChecks(sessionId: string): Promise<{ userUuid: string; checks: TurnChecks }[]>
  /** Session's day: what to ask today, what waits, how the evening's run went. */
  sessionToday(): Promise<SessionDay>
  answerCard(id: number, choice: number): Promise<CardAnswer>
  /** known: I know this (not asked again); disputed: Answer looks wrong. */
  setCardAside(id: number, why: "known" | "disputed"): Promise<{ id: number; status: string }>
  /** keep and discuss leave the book; change puts Claude's words in, the translator's write (⌘Z). */
  decideChallenge(id: number, decision: "keep" | "discuss" | "change"): Promise<{ id: number; status: string }>
  /** Ten more new cards, or three more challenges, today. */
  moreToday(kind: "cards" | "challenges"): Promise<unknown>
  /** Words of a paragraph's source to be asked about: picked (Add to Session) or asked Claude about. */
  pickWords(input: { segmentId: number; quote: string; origin: "picked" | "asked" }): Promise<{ id: number }>
  /** Claude makes more cards now from the last week, or tries tonight's run again; Session hears when it ends. */
  makeMoreCards(): Promise<{ started: true }>
  retryEvening(): Promise<{ started: true }>
  /** Hear that Session's cards, answers or runs changed (and "resync" after a reconnect). */
  watchSession(onChange: () => void): () => void
}
