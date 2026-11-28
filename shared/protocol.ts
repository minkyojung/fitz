// What the page asks of the server and what it gets back: one closed list, used by both ends.
// The server checks every params it receives; the page checks every result. The shapes follow the existing
// database (docs/data-contract.md) and keep the prototype's field names.
import { z } from "zod"

/** Said by both ends when they first meet; a mismatch is an error, never a guess. Raised whenever a shape here changes. */
export const PROTOCOL_VERSION = 3

// A paragraph's text as the editor keeps it (ProseMirror JSON): doc → paragraph → text, nothing else.
// A text node may carry marks (the prototype's review editor can set italic); they are passed on as they are.
const Mark = z.looseObject({ type: z.string() })
const TextNode = z.strictObject({ type: z.literal("text"), text: z.string(), marks: z.array(Mark).optional() })
const ParagraphNode = z.strictObject({ type: z.literal("paragraph"), content: z.array(TextNode).optional() })
export const Doc = z.strictObject({ type: z.literal("doc"), content: z.array(ParagraphNode).min(1) })
export type Doc = z.infer<typeof Doc>

export const Book = z.strictObject({
  id: z.int(),
  title: z.string(),
  author: z.string().nullable(),
})
export type Book = z.infer<typeof Book>

export const Chapter = z.strictObject({
  id: z.int(),
  /** Order in the book, from 0. */
  idx: z.int(),
  title: z.string(),
  startPage: z.int().nullable(),
  segmentCount: z.int(),
  /** Paragraphs that have a translation (target_doc is not NULL). */
  translatedCount: z.int(),
  /** Paragraphs whose status is reviewed or final. */
  confirmedCount: z.int(),
  /** Paragraphs checked against the original page. */
  verifiedCount: z.int(),
})
export type Chapter = z.infer<typeof Chapter>

export const SEGMENT_KINDS = ["paragraph", "heading", "blockquote", "caption", "verse"] as const
export const SEGMENT_STATUSES = ["untranslated", "draft", "reviewed", "final"] as const

/** A translation typed but not saved: kept by the server while an edit is open, so a crash or a refused save loses
 *  nothing. Not part of the book's history. */
export const Draft = z.strictObject({
  doc: Doc,
  /** The paragraph's version when the edit began; another version now means the paragraph changed since. */
  baseVersion: z.int(),
  savedAt: z.string(),
})
export type Draft = z.infer<typeof Draft>

export const Segment = z.strictObject({
  id: z.int(),
  chapterId: z.int(),
  /** Order in the chapter, from 0. */
  idx: z.int(),
  kind: z.enum(SEGMENT_KINDS),
  pageStart: z.int(),
  pageEnd: z.int(),
  sourceText: z.string(),
  sourceDoc: Doc,
  /** null = not translated (the prototype said ""). */
  targetText: z.string().nullable(),
  targetDoc: Doc.nullable(),
  status: z.enum(SEGMENT_STATUSES),
  verified: z.boolean(),
  version: z.int(),
  draft: Draft.nullable(),
})
export type Segment = z.infer<typeof Segment>

/** What a save may change of a paragraph. Left out = left as it is. */
export const SegmentPatch = z.strictObject({
  /** The source as plain text; `sourceDoc` wins when both are sent. */
  sourceText: z.string().optional(),
  /** One paragraph. */
  sourceDoc: Doc.optional(),
  kind: z.enum(SEGMENT_KINDS).optional(),
  verified: z.boolean().optional(),
  /** One or more paragraphs; null takes the translation away. */
  targetDoc: Doc.nullable().optional(),
  status: z.enum(SEGMENT_STATUSES).optional(),
})
export type SegmentPatch = z.infer<typeof SegmentPatch>

/** A logged change, as undo and redo name it. */
export const Change = z.strictObject({
  id: z.int(),
  name: z.string(),
  /** The paragraphs it touched. */
  segmentIds: z.array(z.int()),
  actor: z.enum(["translator", "agent"]),
})
export type Change = z.infer<typeof Change>

const none = z.strictObject({})

/** Every request there is: its name, what is sent with it, what comes back. */
export const REQUESTS = {
  getBook: { params: none, result: Book },
  listChapters: { params: none, result: z.array(Chapter) },
  listSegments: { params: z.strictObject({ chapterId: z.int() }), result: z.array(Segment) },
  /** Save a paragraph. `expectVersion` is the version the page last saw: if the paragraph changed since, nothing is
   *  written (409) — the translator and Claude both write, and neither overwrites what the other wrote unseen. */
  updateSegment: { params: z.strictObject({ id: z.int(), patch: SegmentPatch, expectVersion: z.int() }), result: Segment },
  /** Keep what is being typed into a paragraph's translation. Saving the translation drops it. */
  saveDraft: { params: z.strictObject({ segmentId: z.int(), doc: Doc, baseVersion: z.int() }), result: z.null() },
  dropDraft: { params: z.strictObject({ segmentId: z.int() }), result: z.null() },
  /** Take back the translator's last change still standing; null when there is none. Refused (409) when a later change touched the same thing. */
  undo: { params: none, result: Change.nullable() },
  /** Do again the translator's change taken back last; null when there is none. */
  redo: { params: none, result: Change.nullable() },
} as const

export type RequestName = keyof typeof REQUESTS
export type Params<N extends RequestName> = z.infer<(typeof REQUESTS)[N]["params"]>
export type Result<N extends RequestName> = z.infer<(typeof REQUESTS)[N]["result"]>

export const isRequestName = (name: string): name is RequestName => Object.hasOwn(REQUESTS, name)

/** The first thing the page says to the server, and what it hears back. A page of another protocol is refused (409). */
export const HelloParams = z.strictObject({ protocol: z.int() })
export const Hello = z.strictObject({
  protocol: z.int(),
  /** New each time the server starts: what the page holds from another boot is thrown away. */
  bootId: z.string().min(1),
  /** Counts the book's changes within a boot. Nothing writes yet, so it stays 0. */
  revision: z.int(),
})
export type Hello = z.infer<typeof Hello>

/** What a request that failed gets back. */
export const ErrorBody = z.strictObject({ error: z.string() })
export type ErrorBody = z.infer<typeof ErrorBody>
