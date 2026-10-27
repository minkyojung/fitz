// The agent's tools over book.db, one per question it asks (docs/agent.md §3).
// Read tools return plain text only: no ProseMirror JSON, no OCR original, no page boxes or file paths,
// so nothing but the book's text can reach the model. Write tools go through execute(), like every edit the
// translator makes: each is logged and undone with ⌘Z. Claude Code asks the app before each write (session.mjs).
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk"
import { z } from "zod"

import { locateAnchor, makeAnchor } from "../anchor.mjs"
import { anchorOf, docText, execute, getBook, httpError, listChapters, listGlossary, replaceRange, search } from "../commands.mjs"
import { termPattern } from "./glossaryRule.mjs"

/** Characters of text one `read` returns before it stops and hands back `next`. Claude Code moves an MCP
 *  result over 25,000 tokens or 50,000 characters into a file, which this agent has no tool to open. */
export const READ_BUDGET = 20000

/** The words of the translation an author's note's number follows, while they are there; null: no place in it. */
function placedAfter(n, target) {
  const a = anchorOf(n, "tgt")
  const at = a && target ? locateAnchor(target, a) : null
  return at ? target.slice(at.start, at.end) : null
}

/** Glossary terms a source paragraph mentions, by the glossary rule the editor uses too (glossaryRule.mjs). */
const termsIn = (text, entries) =>
  entries.filter((e) => e.term.trim() && termPattern(e.term).test(text))
    .map(({ term, translation, aliases, kind }) => ({ term, translation, aliases, kind }))

export function book(db) {
  const chapters = listChapters(db).map(({ id, idx, title, startPage, segmentCount, confirmedCount }) => ({ id, idx, title, startPage, segmentCount, confirmedCount }))
  return { ...getBook(db), chapters }
}

const BOOK_ORDER = "SELECT s.* FROM segment s JOIN chapter c ON c.id = s.chapter_id"
const NOTES_OF = "SELECT * FROM note WHERE segment_id = ? ORDER BY tgt_start, id"

/** A note as the tools give it: an author's note with its translation and its place in the translation `target`; a
 *  translator's note with the words it follows. */
const noteOut = (n, target) => n.kind === "author"
  ? { id: n.id, kind: "author", text: n.body_source ?? "", translation: n.body_target ?? "", quote: anchorOf(n, "src")?.exact ?? n.orig_quote ?? null, placedAfter: placedAfter(n, target) }
  : { id: n.id, kind: "translator", text: n.body_target ?? "", quote: anchorOf(n, "tgt")?.exact ?? null }
const commentOut = (c) => ({ id: c.id, parentId: c.parent_id ?? null, side: c.side, author: c.author, body: c.body, resolved: c.resolved === 1, quote: anchorOf(c, "src")?.exact ?? null })
/** Characters of notes and comments, as READ_BUDGET counts them. */
const attachedSize = (notes, comments) =>
  notes.reduce((n, x) => n + x.text.length + (x.translation?.length ?? 0), 0) + comments.reduce((n, x) => n + x.body.length, 0)

/** Paragraphs with what is attached to them. Exactly one of `ids` / `chapterId`; `around` widens a single id
 *  to its neighbours in the chapter; `from` continues a chapter at that idx. Stops at READ_BUDGET. */
export function read(db, { ids, chapterId, around, from } = {}) {
  if ((ids === undefined) === (chapterId === undefined)) throw httpError(400, "give either ids or chapterId")
  if (around !== undefined && ids?.length !== 1) throw httpError(400, "around needs exactly one id")
  if (from !== undefined && chapterId === undefined) throw httpError(400, "from goes with chapterId")
  let rows
  if (chapterId !== undefined) {
    if (!db.prepare("SELECT 1 FROM chapter WHERE id = ?").get(chapterId)) throw httpError(404, `chapter ${chapterId} not found`)
    rows = db.prepare("SELECT * FROM segment WHERE chapter_id = ? AND idx >= ? ORDER BY idx").all(chapterId, from ?? 0)
  } else {
    const found = db.prepare(`${BOOK_ORDER} WHERE s.id IN (${ids.map(() => "?").join(",")}) ORDER BY c.idx, s.idx`).all(...ids)
    const missing = ids.filter((id) => !found.some((r) => r.id === id))
    if (missing.length) throw httpError(404, `segment ${missing.join(", ")} not found`)
    rows = around === undefined ? found
      : db.prepare("SELECT * FROM segment WHERE chapter_id = ? AND idx BETWEEN ? AND ? ORDER BY idx").all(found[0].chapter_id, found[0].idx - around, found[0].idx + around)
  }

  const terms = db.prepare("SELECT term, translation, aliases, kind FROM glossary WHERE book_id = ?").all(getBook(db).id)
    .map((r) => ({ term: r.term, translation: r.translation, aliases: r.aliases ?? "", kind: r.kind }))
  const notesOf = db.prepare(NOTES_OF)
  const commentsOf = db.prepare("SELECT * FROM comment WHERE segment_id = ? ORDER BY id")
  const segments = []
  let used = 0
  for (const r of rows) {
    const notes = notesOf.all(r.id).map((n) => noteOut(n, r.target_text))
    const comments = commentsOf.all(r.id).map(commentOut)
    const seg = {
      id: r.id, chapterId: r.chapter_id, idx: r.idx, kind: r.kind, pageStart: r.page_start, pageEnd: r.page_end,
      status: r.status, version: r.version, sourceText: r.source_text, targetText: r.target_text ?? "",
      notes, comments, terms: termsIn(r.source_text, terms),
    }
    const size = seg.sourceText.length + seg.targetText.length + attachedSize(notes, comments)
    if (segments.length && used + size > READ_BUDGET) {
      const rest = rows.slice(segments.length)
      return { segments, next: chapterId !== undefined ? { chapterId, from: rest[0].idx } : { ids: rest.map((x) => x.id) } }
    }
    segments.push(seg)
    used += size
  }
  return { segments }
}

/** What is attached to a chapter's paragraphs, without their text: every note, and the comment threads still open with
 *  their replies. Paragraphs with neither are left out. `from` continues at that idx; stops at READ_BUDGET, like read. */
export function annotations(db, { chapterId, from = 0 }) {
  if (!db.prepare("SELECT 1 FROM chapter WHERE id = ?").get(chapterId)) throw httpError(404, `chapter ${chapterId} not found`)
  const rows = db.prepare("SELECT id, idx, status, target_text FROM segment WHERE chapter_id = ? AND idx >= ? ORDER BY idx").all(chapterId, from)
  const notesOf = db.prepare(NOTES_OF)
  // a thread is open while its first comment is not resolved; a reply is open with its thread
  const openOf = db.prepare(`SELECT c.* FROM comment c LEFT JOIN comment root ON root.id = c.parent_id
                             WHERE c.segment_id = ? AND coalesce(root.resolved, c.resolved) = 0 ORDER BY c.id`)
  const paragraphs = []
  let used = 0
  for (const r of rows) {
    const notes = notesOf.all(r.id).map((n) => noteOut(n, r.target_text))
    const comments = openOf.all(r.id).map(commentOut)
    if (!notes.length && !comments.length) continue
    const size = attachedSize(notes, comments)
    if (paragraphs.length && used + size > READ_BUDGET) return { paragraphs, next: { chapterId, from: r.idx } }
    paragraphs.push({ segmentId: r.id, idx: r.idx, status: r.status, notes, comments })
    used += size
  }
  return { paragraphs }
}

export const glossary = (db) =>
  ({ terms: listGlossary(db, { bookId: getBook(db).id }).map(({ term, translation, aliases, kind, occurrences }) => ({ term, translation, aliases, kind, occurrences })) })

export const searchBook = (db, { query, side }) => ({ hits: search(db, { query, side }) })

// --- writes: the agent's door. Each is recorded as the agent's, with the id of the tool call that made it.

/** The agent as the author of a write; toolUseId is what Claude Code hands a tool call (measured, 2.1.302). */
export const agentBy = (extra) => ({ actor: "agent", toolUseId: extra?._meta?.["claudecode/toolUseId"] ?? null })
const AGENT = agentBy(undefined)

const KINDS = ["person", "place", "org", "work", "other"]

function segmentAt(db, id) {
  const row = db.prepare("SELECT * FROM segment WHERE id = ?").get(id)
  if (!row) throw httpError(404, `segment ${id} not found`)
  return row
}
/** Translation text as blocks: one per line, blank lines dropped. */
const blocksOf = (text) => text.split("\n").map((l) => l.trim()).filter(Boolean)
/** Where a quote is in the text. It must be found once, so it points at one place. */
function quoteAt(text, quote, where) {
  const at = text.indexOf(quote)
  if (!quote || at === -1) throw httpError(400, `"${quote}" is not in the paragraph's ${where}`)
  if (text.indexOf(quote, at + 1) !== -1) throw httpError(400, `"${quote}" appears more than once in the paragraph's ${where}; quote more of it`)
  return at
}
function quoteAnchor(text, quote, where) {
  if (quote === undefined) return null
  const at = quoteAt(text, quote, where)
  return makeAnchor(text, at, at + quote.length)
}

const CHANGED = (id) => `¶${id} changed since you read it; read it again before writing`
const demotion = (cur) => (cur.status === "reviewed" || cur.status === "final" ? ` (it is ${cur.status}; it becomes draft)` : "")

/** The translation with the quoted words replaced, and the rest of it — the other blocks, italics — as it was. Within
 *  one block, never emptying one: changing the blocks is set_translation's. */
function editedDoc(cur, quote, replacement) {
  const doc = cur.target_doc ? JSON.parse(cur.target_doc) : null
  const text = doc ? docText(doc) : ""
  if (!text.trim()) throw httpError(400, `¶${cur.id} has no translation yet; write it with set_translation`)
  if (quote.includes("\n")) throw httpError(400, "quote words within one block of the translation")
  if (replacement.includes("\n")) throw httpError(400, "the replacement cannot hold a line break; to change the blocks, use set_translation")
  if (replacement === quote) throw httpError(400, "the replacement is the same as the quoted words")
  const at = quoteAt(text, quote, "translation")
  const end = text.indexOf("\n", at)
  const block = text.slice(text.lastIndexOf("\n", at) + 1, at) + replacement + text.slice(at + quote.length, end === -1 ? text.length : end)
  if (!block.trim()) throw httpError(400, "the edit would empty a block; to remove a block, use set_translation")
  return replaceRange(doc, at, at + quote.length, replacement)
}

/** Write a paragraph's translation, always as draft: confirming is the translator's. expectVersion is the version
 *  read gave; updateSegment refuses the write if the paragraph changed since — the same check the editor's saves get. */
export function setTranslation(db, { segmentId, text, expectVersion }, by = AGENT) {
  const blocks = blocksOf(text)
  if (!blocks.length) throw httpError(400, "the translation is empty")
  const targetDoc = { type: "doc", content: blocks.map((b) => ({ type: "paragraph", content: [{ type: "text", text: b }] })) }
  try {
    const seg = execute(db, "updateSegment", { id: segmentId, targetDoc, status: "draft", expectVersion }, by)
    return { segmentId, status: seg.status, version: seg.version, targetText: seg.targetText }
  } catch (e) {
    throw e.status === 409 ? httpError(409, CHANGED(segmentId)) : e
  }
}

/** Change some words of a paragraph's translation, the rest as it was. As draft and over the version read, like
 *  set_translation; the version is checked first, so a changed paragraph is not reported as missing the words. */
export function editTranslation(db, { segmentId, quote, replacement, expectVersion }, by = AGENT) {
  const cur = segmentAt(db, segmentId)
  if (cur.version !== expectVersion) throw httpError(409, CHANGED(segmentId))
  const seg = execute(db, "updateSegment", { id: segmentId, targetDoc: editedDoc(cur, quote, replacement), status: "draft", expectVersion }, by)
  return { segmentId, status: seg.status, version: seg.version, targetText: seg.targetText }
}

/** Agree a term's Korean form. Aliases and kind not given keep what the entry had. */
export function setGlossaryTerm(db, { term, translation, aliases, kind }, by = AGENT) {
  const bookId = getBook(db).id
  const cur = db.prepare("SELECT * FROM glossary WHERE book_id = ? AND term = ?").get(bookId, term)
  return execute(db, "setGlossaryTerm", { bookId, term, translation, aliases: aliases ?? cur?.aliases ?? "", kind: kind ?? cur?.kind ?? "other" }, by)
}

export function addComment(db, { segmentId, side, body, quote }, by = AGENT) {
  const cur = segmentAt(db, segmentId)
  const anchor = quoteAnchor(side === "source" ? cur.source_text : cur.target_text ?? "", quote, side === "source" ? "source" : "translation")
  const c = execute(db, "addComment", { segmentId, side, anchor, body, author: by.actor }, by)
  return { id: c.id, segmentId, side, quote: quote ?? null }
}

function commentAt(db, id) {
  const row = db.prepare("SELECT * FROM comment WHERE id = ?").get(id)
  if (!row) throw httpError(404, `comment ${id} not found`)
  return row
}
/** The thread a comment is in, as its first comment: a reply goes to the thread, as the editor's reply box does. */
function threadOf(db, id) {
  const c = commentAt(db, id)
  return c.parent_id == null ? c : commentAt(db, c.parent_id)
}
function replyTo(db, { commentId, body }) {
  const root = threadOf(db, commentId)
  if (!body?.trim()) throw httpError(400, "the reply is empty")
  if (root.resolved) throw httpError(400, `the thread of comment ${commentId} is resolved`)
  return root
}
/** Claude closes only a thread it opened: one the translator opened is theirs to close. */
function toResolve(db, { commentId }) {
  const root = threadOf(db, commentId)
  if (root.author !== "agent") throw httpError(400, `the thread of comment ${commentId} is the translator's to resolve; reply to say what you did`)
  if (root.resolved) throw httpError(400, `the thread of comment ${commentId} is already resolved`)
  return root
}

export function replyComment(db, { commentId, body }, by = AGENT) {
  const root = replyTo(db, { commentId, body })
  const c = execute(db, "addComment", { segmentId: root.segment_id, side: root.side, anchor: null, body, parentId: root.id, author: by.actor }, by)
  return { id: c.id, segmentId: root.segment_id, threadId: root.id }
}

export function resolveComment(db, { commentId }, by = AGENT) {
  const root = toResolve(db, { commentId })
  execute(db, "setComment", { id: root.id, resolved: true }, by)
  return { threadId: root.id, segmentId: root.segment_id, resolved: true }
}

/** A translator's note sits in the translation: its quote is found there. */
export function addTranslatorNote(db, { segmentId, body, quote }, by = AGENT) {
  const cur = segmentAt(db, segmentId)
  if (quote !== undefined && !cur.target_text) throw httpError(400, `¶${segmentId} has no translation yet to place the note in`)
  const n = execute(db, "addNote", { segmentId, anchor: quoteAnchor(cur.target_text ?? "", quote, "translation"), body }, by)
  return { id: n.id, segmentId, quote: quote ?? null }
}

function noteAt(db, id) {
  const row = db.prepare("SELECT * FROM note WHERE id = ?").get(id)
  if (!row) throw httpError(404, `note ${id} not found`)
  return row
}
/** What set_note would change, checked: something to change, a body with words in it, and the quote once in the
 *  paragraph's translation. An author's note the build could not match to the book's text sits on a guessed paragraph
 *  until the translator links it (Notes → Link): it is not placed before that. */
function noteChange(db, { noteId, body, quote }) {
  const note = noteAt(db, noteId)
  if (body === undefined && quote === undefined) throw httpError(400, "give the note's body, a quote to place it at, or both")
  if (body !== undefined && !body.trim()) throw httpError(400, "the note's body is empty")
  if (quote !== undefined && note.kind === "author" && !note.anchored) throw httpError(400, `the author's note ${noteId} is not linked to its paragraph yet; the translator links it (Notes → Link) before it is placed`)
  const cur = segmentAt(db, note.segment_id)
  if (quote !== undefined && !cur.target_text) throw httpError(400, `¶${cur.id} has no translation yet to place the note in`)
  return { note, cur, targetAnchor: quote === undefined ? undefined : quoteAnchor(cur.target_text, quote, "translation") }
}

/** An author's note translated (the book's own text of it stays), or a translator's note changed; with `quote`, its
 *  number placed right after those words of the translation. */
export function setNote(db, { noteId, body, quote }, by = AGENT) {
  const { targetAnchor } = noteChange(db, { noteId, body, quote })
  const n = execute(db, "setNote", { id: noteId, body, targetAnchor }, by)
  return { id: n.id, segmentId: n.segmentId, kind: n.kind, quote: quote ?? null }
}

/** A comment in a few words, for a line that names it. */
const gist = (text) => {
  const t = text.replace(/\s+/g, " ").trim()
  return t.length > 40 ? `${t.slice(0, 39)}…` : t
}

/** What a write would do, for the translator to approve: a line saying what, and the text before and after.
 *  It checks what the write will check, so the translator is never asked about a write that would then fail. */
export function describeWrite(db, tool, input) {
  switch (tool) {
    case "set_translation": {
      const cur = segmentAt(db, input.segmentId)
      if (cur.version !== input.expectVersion) throw httpError(409, CHANGED(cur.id))
      if (!blocksOf(input.text).length) throw httpError(400, "the translation is empty")
      return { summary: `Write the translation of ¶${cur.id}${demotion(cur)}`, segmentId: cur.id, before: cur.target_text || null, after: blocksOf(input.text).join("\n") }
    }
    case "edit_translation": {
      const cur = segmentAt(db, input.segmentId)
      if (cur.version !== input.expectVersion) throw httpError(409, CHANGED(cur.id))
      return { summary: `Edit the translation of ¶${cur.id}${demotion(cur)}`, segmentId: cur.id, before: cur.target_text, after: docText(editedDoc(cur, input.quote, input.replacement)) }
    }
    case "set_glossary_term": {
      const cur = db.prepare("SELECT * FROM glossary WHERE book_id = ? AND term = ?").get(getBook(db).id, input.term)
      return { summary: `Glossary: ${input.term} → ${input.translation}`, segmentId: null, before: cur ? `${cur.term} → ${cur.translation}` : null, after: `${input.term} → ${input.translation}${input.aliases ? ` (also ${input.aliases})` : ""}` }
    }
    case "add_comment": {
      const cur = segmentAt(db, input.segmentId)
      quoteAnchor(input.side === "source" ? cur.source_text : cur.target_text ?? "", input.quote, input.side === "source" ? "source" : "translation")
      return { summary: `Comment by Claude on ¶${cur.id}${input.quote ? ` at "${input.quote}"` : ""}`, segmentId: input.segmentId, before: null, after: input.body }
    }
    case "reply_comment": {
      const root = replyTo(db, input)
      return { summary: `Reply by Claude on ¶${root.segment_id} to "${gist(root.body)}"`, segmentId: root.segment_id, before: null, after: input.body }
    }
    case "resolve_comment": {
      const root = toResolve(db, input)
      return { summary: `Resolve Claude's comment on ¶${root.segment_id}`, segmentId: root.segment_id, before: null, after: root.body }
    }
    case "add_translator_note": {
      const cur = segmentAt(db, input.segmentId)
      if (input.quote !== undefined && !cur.target_text) throw httpError(400, `¶${cur.id} has no translation yet to place the note in`)
      quoteAnchor(cur.target_text ?? "", input.quote, "translation")
      return { summary: `Translator's note on ¶${cur.id}${input.quote ? ` after "${input.quote}"` : ""} — it will be printed`, segmentId: input.segmentId, before: null, after: input.body }
    }
    case "set_note": {
      const { note, cur } = noteChange(db, input)
      const author = note.kind === "author"
      const what = `the ${author ? "author's" : "translator's"} note ${note.id}`
      const place = `${author ? "place" : "move"} it after "${input.quote}"`
      const summary = input.body === undefined
        ? `${author ? "Place" : "Move"} ${what} after "${input.quote}" in ¶${cur.id}`
        : `${author ? "Translate" : "Change"} ${what} on ¶${cur.id}${input.quote === undefined ? "" : ` and ${place}`} — it will be printed`
      return { summary, segmentId: cur.id, before: input.body === undefined ? null : note.body_target || null, after: input.body ?? null }
    }
    default:
      throw httpError(400, `${tool} is not a write tool`)
  }
}

// --- MCP: the same functions as tools. A thrown error reaches the model as an error result and the turn goes on.

const result = (data) => ({ content: [{ type: "text", text: JSON.stringify(data) }], structuredContent: data })
const READ_ONLY = { annotations: { readOnlyHint: true } }

export const readTools = (db) => [
  tool("book", "The book being translated: title, author, and its chapters in order with how many paragraphs each has and how many are confirmed.",
    {}, async () => result(book(db)), READ_ONLY),
  tool("read",
    "Read paragraphs: the English source, the Korean translation so far (empty if none), status, and what is attached — author's notes (placedAfter: the words of the translation its number follows; null if it has no place there yet), translator's notes, comments, and the glossary terms the paragraph mentions with their agreed Korean form. " +
    "Give `ids`, or `chapterId` for a whole chapter. With one id, `around: n` adds n paragraphs before and after it in the same chapter. " +
    "Long reads stop part way and return `next`: call read again with exactly those arguments to continue.",
    {
      ids: z.array(z.number().int()).min(1).max(200).optional().describe("Paragraph ids, returned in book order"),
      chapterId: z.number().int().optional().describe("Read a chapter's paragraphs in order"),
      around: z.number().int().min(1).max(10).optional().describe("With exactly one id: paragraphs on each side to include"),
      from: z.number().int().min(0).optional().describe("With chapterId: start at this paragraph idx (as given in `next`)"),
    },
    async (args) => result(read(db, args)), READ_ONLY),
  tool("glossary", "The book's glossary: each source term, its agreed Korean form (empty = not decided yet), accepted variants, kind, and how many paragraphs mention it.",
    {}, async () => result(glossary(db)), READ_ONLY),
  tool("search", "Find paragraphs whose English source — or, with side \"target\", whose Korean translation — contains the exact text (case-sensitive). Returns where, how many times, and a snippet.",
    {
      query: z.string().min(1).describe("Exact text to find"),
      side: z.enum(["source", "target"]).optional().describe("source (default): the English; target: the translation so far"),
    },
    async (args) => result(searchBook(db, args)), READ_ONLY),
  tool("annotations",
    "What is attached to a chapter's paragraphs, without their text: every note (author's notes with their translation and placedAfter, translator's notes) and the comment threads still open, with their replies. " +
    "Paragraphs with neither are left out; read a paragraph for its text. Long results stop part way and return `next`: call again with exactly those arguments to continue.",
    {
      chapterId: z.number().int(),
      from: z.number().int().min(0).optional().describe("Start at this paragraph idx (as given in `next`)"),
    },
    async (args) => result(annotations(db, args)), READ_ONLY),
]

/** The in-process MCP server handed to query() as mcpServers.fitz. alwaysLoad keeps the schemas in the prompt,
 *  so the first call is not preceded by a ToolSearch round trip. */
/** `wrote(segmentId)` hears each paragraph a set_translation wrote, as it is written: the checks of the turn
 *  (docs/agent.md §19) take these, with no wait on the stream. */
export const writeTools = (db, { wrote } = {}) => [
  tool("set_translation",
    "Write the Korean translation of one paragraph, replacing what is there. It is saved as a draft for the translator to confirm. " +
    "Pass the paragraph's `version` from your last read as `expectVersion`; if the paragraph changed since (the translator may be editing too), the write is refused and you should read it again. " +
    "Separate blocks with a newline. To change only some words, use edit_translation. The translator is asked before it is written.",
    {
      segmentId: z.number().int(),
      text: z.string().min(1).describe("The whole translation of the paragraph"),
      expectVersion: z.number().int().describe("version of the paragraph as read returned it"),
    },
    async (args, extra) => {
      const out = setTranslation(db, args, agentBy(extra))
      wrote?.(out.segmentId)
      return result(out)
    }),
  tool("edit_translation",
    "Change some words of one paragraph's translation and keep the rest as it is: its other sentences, and the words notes and comments are placed at. " +
    "`quote` is the exact words to change, found once in the translation and within one block; `replacement` is what they become (empty deletes them). " +
    "It is saved as a draft for the translator to confirm. Pass the paragraph's `version` from your last read as `expectVersion`; if the paragraph changed since, the write is refused and you should read it again. " +
    "The translator is asked before it is written.",
    {
      segmentId: z.number().int(),
      quote: z.string().min(1).describe("Exact words of the translation, found once, within one block"),
      replacement: z.string().describe("What they become; empty to delete them"),
      expectVersion: z.number().int().describe("version of the paragraph as read returned it"),
    },
    async (args, extra) => {
      const out = editTranslation(db, args, agentBy(extra))
      wrote?.(out.segmentId)
      return result(out)
    }),
  tool("set_glossary_term",
    "Agree the Korean form of a source term (a name, place, title…) for the whole book, or change it. The translator is asked first.",
    {
      term: z.string().min(1).describe("The term as it appears in the English source"),
      translation: z.string().min(1).describe("Its agreed Korean form"),
      aliases: z.string().optional().describe("Other accepted Korean forms, comma-separated"),
      kind: z.enum(KINDS).optional(),
    },
    async (args, extra) => result(setGlossaryTerm(db, args, agentBy(extra)))),
  tool("add_comment",
    "Leave a working comment on a paragraph for the translator (never printed). `quote` pins it to exact words in that side's text. The translator is asked first.",
    {
      segmentId: z.number().int(),
      side: z.enum(["source", "target"]).describe("source: the English; target: the translation"),
      body: z.string().min(1),
      quote: z.string().optional().describe("Exact words from that side, found once"),
    },
    async (args, extra) => result(addComment(db, args, agentBy(extra)))),
  tool("reply_comment",
    "Reply in a comment's thread, as the translator does under a comment (never printed). `commentId` is any comment of the thread, as read gives it; a resolved thread takes no replies. The translator is asked first.",
    {
      commentId: z.number().int(),
      body: z.string().min(1),
    },
    async (args, extra) => result(replyComment(db, args, agentBy(extra)))),
  tool("resolve_comment",
    "Resolve a thread you opened (its first comment's author is \"agent\") once what it raised is settled. A thread the translator opened is theirs to resolve: reply in it to say what you did. The translator is asked first.",
    { commentId: z.number().int().describe("Any comment of the thread") },
    async (args, extra) => result(resolveComment(db, args, agentBy(extra)))),
  tool("add_translator_note",
    "Add a translator's note (역주) to a paragraph; it is printed in the book. `quote` places its mark right after exact words of the translation. The translator is asked first.",
    {
      segmentId: z.number().int(),
      body: z.string().min(1).describe("The note's text, in Korean"),
      quote: z.string().optional().describe("Exact words of the translation, found once"),
    },
    async (args, extra) => result(addTranslatorNote(db, args, agentBy(extra)))),
  tool("set_note",
    "Translate an author's note, or change a translator's note (역주); both are printed in the book. `body` is the note's text in Korean. " +
    "`quote` puts the note's number right after exact words of the paragraph's translation: for an author's note whose placedAfter is null, or to move a note. Give either or both. The translator is asked first.",
    {
      noteId: z.number().int(),
      body: z.string().min(1).optional().describe("The note in Korean: an author's note's translation, or a translator's note's new text"),
      quote: z.string().optional().describe("Exact words of the translation, found once, that the number goes after"),
    },
    async (args, extra) => result(setNote(db, args, agentBy(extra)))),
]

export const READ_TOOL_NAMES = ["book", "read", "glossary", "search", "annotations"]
export const WRITE_TOOL_NAMES = ["set_translation", "edit_translation", "set_glossary_term", "add_comment", "reply_comment", "resolve_comment", "add_translator_note", "set_note"]

/** `write: false` for the tasks, which only find: Claude is not even offered the write tools. */
export const fitzTools = (db, { write = true, wrote } = {}) => (write ? [...readTools(db), ...writeTools(db, { wrote })] : readTools(db))
export const fitzServer = (db, options) => createSdkMcpServer({ name: "fitz", version: "0.1.0", alwaysLoad: true, tools: fitzTools(db, options) })
