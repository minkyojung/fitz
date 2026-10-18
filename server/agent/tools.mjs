// The agent's tools over book.db, one per question it asks (docs/agent.md §3).
// Read tools return plain text only: no ProseMirror JSON, no OCR original, no page boxes or file paths,
// so nothing but the book's text can reach the model.
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk"
import { z } from "zod"

import { anchorOf, getBook, httpError, listChapters, listGlossary, search } from "../commands.mjs"

/** Characters of text one `read` returns before it stops and hands back `next`. Claude Code moves an MCP
 *  result over 25,000 tokens or 50,000 characters into a file, which this agent has no tool to open. */
export const READ_BUDGET = 20000

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
/** Glossary terms a source paragraph mentions — the rule of app/src/lib/glossary.ts findTerms:
 *  whole word, case-insensitive, possessive or plural tail allowed. */
const termsIn = (text, entries) =>
  entries.filter((e) => e.term.trim() && new RegExp(`(?<![A-Za-z])${escape(e.term)}(?:[’']s|s)?(?![A-Za-z])`, "i").test(text))
    .map(({ term, translation, aliases, kind }) => ({ term, translation, aliases, kind }))

export function book(db) {
  const chapters = listChapters(db).map(({ id, idx, title, startPage, segmentCount, confirmedCount }) => ({ id, idx, title, startPage, segmentCount, confirmedCount }))
  return { ...getBook(db), chapters }
}

const BOOK_ORDER = "SELECT s.* FROM segment s JOIN chapter c ON c.id = s.chapter_id"

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
  const notesOf = db.prepare("SELECT * FROM note WHERE segment_id = ? ORDER BY tgt_start, id")
  const commentsOf = db.prepare("SELECT * FROM comment WHERE segment_id = ? ORDER BY id")
  const segments = []
  let used = 0
  for (const r of rows) {
    const notes = notesOf.all(r.id).map((n) => n.kind === "author"
      ? { id: n.id, kind: "author", text: n.body_source ?? "", translation: n.body_target ?? "", quote: anchorOf(n, "src")?.exact ?? n.orig_quote ?? null }
      : { id: n.id, kind: "translator", text: n.body_target ?? "", quote: anchorOf(n, "tgt")?.exact ?? null })
    const comments = commentsOf.all(r.id).map((c) => ({ id: c.id, parentId: c.parent_id ?? null, side: c.side, body: c.body, resolved: c.resolved === 1, quote: anchorOf(c, "src")?.exact ?? null }))
    const seg = {
      id: r.id, chapterId: r.chapter_id, idx: r.idx, kind: r.kind, pageStart: r.page_start, pageEnd: r.page_end,
      status: r.status, updatedAt: r.updated_at, sourceText: r.source_text, targetText: r.target_text ?? "",
      notes, comments, terms: termsIn(r.source_text, terms),
    }
    const size = seg.sourceText.length + seg.targetText.length
      + notes.reduce((n, x) => n + x.text.length + (x.translation?.length ?? 0), 0) + comments.reduce((n, x) => n + x.body.length, 0)
    if (segments.length && used + size > READ_BUDGET) {
      const rest = rows.slice(segments.length)
      return { segments, next: chapterId !== undefined ? { chapterId, from: rest[0].idx } : { ids: rest.map((x) => x.id) } }
    }
    segments.push(seg)
    used += size
  }
  return { segments }
}

export const glossary = (db) =>
  ({ terms: listGlossary(db, { bookId: getBook(db).id }).map(({ term, translation, aliases, kind, occurrences }) => ({ term, translation, aliases, kind, occurrences })) })

export const searchBook = (db, { query }) => ({ hits: search(db, { query }) })

// --- MCP: the same functions as tools. A thrown error reaches the model as an error result and the turn goes on.

const result = (data) => ({ content: [{ type: "text", text: JSON.stringify(data) }], structuredContent: data })
const READ_ONLY = { annotations: { readOnlyHint: true } }

export const readTools = (db) => [
  tool("book", "The book being translated: title, author, and its chapters in order with how many paragraphs each has and how many are confirmed.",
    {}, async () => result(book(db)), READ_ONLY),
  tool("read",
    "Read paragraphs: the English source, the Korean translation so far (empty if none), status, and what is attached — author's notes, translator's notes, comments, and the glossary terms the paragraph mentions with their agreed Korean form. " +
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
  tool("search", "Find paragraphs whose English source contains the exact text (case-sensitive). Returns where, how many times, and a snippet.",
    { query: z.string().min(1).describe("Exact text to find") },
    async (args) => result(searchBook(db, args)), READ_ONLY),
]

/** The in-process MCP server handed to query() as mcpServers.fitz. alwaysLoad keeps the schemas in the prompt,
 *  so the first call is not preceded by a ToolSearch round trip. */
export const fitzServer = (db) => createSdkMcpServer({ name: "fitz", version: "0.1.0", alwaysLoad: true, tools: readTools(db) })
