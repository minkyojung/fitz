// What the page asks of the server and what it gets back: one closed list, used by both ends.
// The server checks every params it receives; the page checks every result. The shapes follow the existing
// database (docs/data-contract.md) and keep the prototype's field names.
import { z } from "zod"

/** Said by both ends when they first meet; a mismatch is an error, never a guess. Raised whenever a shape here changes. */
export const PROTOCOL_VERSION = 1

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
})
export type Segment = z.infer<typeof Segment>

const none = z.strictObject({})

/** Every request there is: its name, what is sent with it, what comes back. */
export const REQUESTS = {
  getBook: { params: none, result: Book },
  listChapters: { params: none, result: z.array(Chapter) },
  listSegments: { params: z.strictObject({ chapterId: z.int() }), result: z.array(Segment) },
} as const

export type RequestName = keyof typeof REQUESTS
export type Params<N extends RequestName> = z.infer<(typeof REQUESTS)[N]["params"]>
export type Result<N extends RequestName> = z.infer<(typeof REQUESTS)[N]["result"]>

export const isRequestName = (name: string): name is RequestName => Object.hasOwn(REQUESTS, name)

/** What a request that failed gets back. */
export const ErrorBody = z.strictObject({ error: z.string() })
export type ErrorBody = z.infer<typeof ErrorBody>
