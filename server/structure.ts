// How a chapter is cut into paragraphs: split one in two, merge one with the next — and the way back from each.
// The prototype's commands (same names, same logged shapes); what is new is that everything that belongs to a paragraph
// goes with it: a merge takes all of the next paragraph's along, and its undo gives all of them back.
import type { DatabaseSync } from "node:sqlite"

import { z } from "zod"

import { Doc, SEGMENT_KINDS, SEGMENT_STATUSES } from "../shared/protocol.ts"
import { RequestError } from "./book.ts"
import { type Command, type Row, checkVersion, docText, getSegment, segmentOut, sent, textDoc } from "./command-kit.ts"

/** Tables whose rows belong to one paragraph (each has `segment_id`). The source-side ones carry offsets into its text. */
const BELONGING = ["note", "comment", "relation", "segment_version", "agent_suggestion", "drill_card", "drill_pick"] as const
type Moved = Partial<Record<(typeof BELONGING)[number], number[]>>

type TextNode = { type: "text"; text: string; marks?: { type: string }[] }
const nodesOf = (doc: Doc): TextNode[] => (doc.content[0]?.content ?? []) as TextNode[]
const oneParagraph = (nodes: TextNode[]): Doc => ({ type: "doc", content: [{ type: "paragraph", content: nodes }] })

/** Drop the blanks at one edge of a paragraph, and text nodes they empty. */
function trimEdge(nodes: TextNode[], edge: "start" | "end"): TextNode[] {
  const out = nodes.map((n) => ({ ...n }))
  while (out.length) {
    const i = edge === "start" ? 0 : out.length - 1
    out[i]!.text = edge === "start" ? out[i]!.text.replace(/^\s+/, "") : out[i]!.text.replace(/\s+$/, "")
    if (out[i]!.text) break
    out.splice(i, 1)
  }
  return out
}

/** A one-paragraph document cut at a text offset, marks kept on either side, the blanks at the cut dropped. */
function splitDoc(doc: Doc, offset: number): [Doc, Doc] {
  const head: TextNode[] = []
  const tail: TextNode[] = []
  let at = 0
  for (const node of nodesOf(doc)) {
    const end = at + node.text.length
    if (end <= offset) head.push(node)
    else if (at >= offset) tail.push(node)
    else {
      head.push({ ...node, text: node.text.slice(0, offset - at) })
      tail.push({ ...node, text: node.text.slice(offset - at) })
    }
    at = end
  }
  return [oneParagraph(trimEdge(head, "end")), oneParagraph(trimEdge(tail, "start"))]
}

/** Two one-paragraph documents joined with one space, marks kept. */
const mergeDocs = (a: Doc, b: Doc): Doc => oneParagraph([...nodesOf(a), { type: "text", text: " " }, ...nodesOf(b)])

type Box = { page_no: number; x0: number; y0: number; x1: number; y1: number }
const boxesOf = (db: DatabaseSync, id: number) =>
  db.prepare("SELECT page_no, x0, y0, x1, y1 FROM segment_box WHERE segment_id = ? ORDER BY page_no").all(id).map((r) => ({ ...r }) as Box)
function setBoxes(db: DatabaseSync, id: number, boxes: Box[]) {
  db.prepare("DELETE FROM segment_box WHERE segment_id = ?").run(id)
  const insert = db.prepare("INSERT INTO segment_box(segment_id, page_no, x0, y0, x1, y1) VALUES (?, ?, ?, ?, ?, ?)")
  for (const b of boxes) insert.run(id, b.page_no, b.x0, b.y0, b.x1, b.y1)
}
/** One box per page around both paragraphs' boxes on it. */
function unionBoxes(a: Box[], b: Box[]): Box[] {
  const pages = new Map<number, Box>()
  for (const box of [...a, ...b]) {
    const was = pages.get(box.page_no)
    pages.set(box.page_no, was
      ? { page_no: box.page_no, x0: Math.min(was.x0, box.x0), y0: Math.min(was.y0, box.y0), x1: Math.max(was.x1, box.x1), y1: Math.max(was.y1, box.y1) }
      : box)
  }
  return [...pages.values()].sort((x, y) => x.page_no - y.page_no)
}

/** Move the paragraphs after `afterIdx` in a chapter by `delta`. Through negative numbers, so UNIQUE(chapter_id, idx)
 *  never collides halfway (SQLite has no ORDER BY on UPDATE). Only the order moves: no paragraph's version does. */
function shiftIdx(db: DatabaseSync, chapterId: number, afterIdx: number, delta: number) {
  db.prepare("UPDATE segment SET idx = -(idx + ?) WHERE chapter_id = ? AND idx > ?").run(delta, chapterId, afterIdx)
  db.prepare("UPDATE segment SET idx = -idx WHERE chapter_id = ? AND idx < 0").run(chapterId)
}

/** How a row is moved to another paragraph. Offsets into the source move by the shift: notes' source anchors, and the
 *  anchors of comments on the source (a comment on the translation points into the translation, which is not cut). */
const MOVE: Record<(typeof BELONGING)[number], string> = {
  note: "UPDATE note SET segment_id = ?, src_start = src_start + ?, src_end = src_end + ? WHERE id = ?",
  comment: `UPDATE comment SET segment_id = ?, src_start = CASE side WHEN 'source' THEN src_start + ? ELSE src_start END,
                                              src_end = CASE side WHEN 'source' THEN src_end + ? ELSE src_end END WHERE id = ?`,
  relation: "UPDATE relation SET segment_id = ? WHERE id = ?",
  segment_version: "UPDATE segment_version SET segment_id = ? WHERE id = ?",
  agent_suggestion: "UPDATE agent_suggestion SET segment_id = ? WHERE id = ?",
  drill_card: "UPDATE drill_card SET segment_id = ? WHERE id = ?",
  drill_pick: "UPDATE drill_pick SET segment_id = ? WHERE id = ?",
}

/** Move what belongs to paragraph `from` — or only the rows named in `only` — to `to`, offsets into the source by
 *  `shift`. Returns the rows moved, by table. */
function moveBelonging(db: DatabaseSync, from: number, to: number, shift: number, only?: Moved): Moved {
  const moved: Moved = {}
  for (const table of BELONGING) {
    const rows = only ? (only[table] ?? []) : db.prepare(`SELECT id FROM "${table}" WHERE segment_id = ?`).all(from).map((r) => Number(r.id))
    if (!rows.length) continue
    moved[table] = rows
    const update = db.prepare(MOVE[table])
    for (const id of rows) {
      if (table === "note" || table === "comment") update.run(to, shift, shift, id)
      else update.run(to, id)
    }
  }
  return moved
}

const RANK = Object.fromEntries(SEGMENT_STATUSES.map((s, i) => [s, i])) as Record<string, number>
/** The translations of two paragraphs made one: the first's paragraphs, then the second's. Its status is the lower of the
 *  two, or a draft when only one of them was translated. */
function joinTranslations(a: Row, b: Row): { doc: string | null; text: string | null; status: string } {
  const first = a.target_doc === null ? null : (JSON.parse(String(a.target_doc)) as Doc)
  const second = b.target_doc === null ? null : (JSON.parse(String(b.target_doc)) as Doc)
  if (!first && !second) return { doc: null, text: null, status: "untranslated" }
  const joined: Doc = { type: "doc", content: [...(first?.content ?? []), ...(second?.content ?? [])] as Doc["content"] }
  const status = first && second ? (RANK[String(a.status)]! <= RANK[String(b.status)]! ? String(a.status) : String(b.status)) : "draft"
  return { doc: JSON.stringify(joined), text: docText(joined), status }
}

const Split = z.strictObject({ id: z.int(), offset: z.int(), tailId: z.int().optional(), expectVersion: z.int().optional() })
// the source as it was stored, put back as it was: the same text written another way is not the same row
const Unsplit = z.strictObject({ headId: z.int(), tailId: z.int(), offset: z.int(), doc: z.string(), text: z.string(), verified: z.boolean(), pageEnd: z.int(), shift: z.int() })
const Merge = z.strictObject({ id: z.int(), expectVersion: z.int().optional() })
const Unmerge = z.strictObject({
  headId: z.int(),
  head: z.strictObject({ doc: z.string(), text: z.string(), pageEnd: z.int(), verified: z.boolean(), targetDoc: z.string().nullable(), targetText: z.string().nullable(), status: z.string(), boxes: z.array(z.any()) }),
  next: z.record(z.string(), z.unknown()),
  nextBoxes: z.array(z.any()),
  moved: z.record(z.string(), z.array(z.int())),
  shift: z.int(),
})

const Insert = z.strictObject({ id: z.int().optional(), chapterId: z.int(), afterIdx: z.int(), kind: z.enum(SEGMENT_KINDS), text: z.string(), pageNo: z.int() })
const Delete = z.strictObject({ id: z.int() })

export const STRUCTURE: Record<string, Command> = {
  /** Cut a paragraph at a text offset of its source. The tail is a new paragraph right after it: same kind, on the head's
   *  last page, not verified, with no OCR text and no translation (the head keeps it: dividing it is the translator's).
   *  Notes and comments in the tail's text go with it; the tail is drawn where its paragraph was. */
  splitSegment(db, params) {
    const p = sent(Split, "splitSegment", params)
    const cur = getSegment(db, p.id)
    checkVersion(cur, p.expectVersion)
    const text = String(cur.source_text)
    if (p.offset <= 0 || p.offset >= text.length) throw new RequestError(400, `splitSegment: the cut must fall inside the text (0 < offset < ${text.length})`)
    const [headDoc, tailDoc] = splitDoc(JSON.parse(String(cur.source_doc)) as Doc, p.offset)
    const head = docText(headDoc)
    const tail = docText(tailDoc)
    if (!head || !tail) throw new RequestError(400, "splitSegment: the cut would leave a paragraph empty")
    // where the tail's text begins in the paragraph's: the cut, and the blanks dropped after it
    const shift = p.offset + (text.slice(p.offset).length - text.slice(p.offset).trimStart().length)

    shiftIdx(db, Number(cur.chapter_id), Number(cur.idx), 1)
    db.prepare("UPDATE segment SET source_doc = ?, source_text = ?, updated_at = datetime('now') WHERE id = ?").run(JSON.stringify(headDoc), head, p.id)
    const tailId = Number(db.prepare(
      `INSERT INTO segment(id, chapter_id, idx, kind, page_start, page_end, source_doc, source_text, ocr_text, verified, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, 0, 'untranslated')`,
    ).run(p.tailId ?? null, Number(cur.chapter_id), Number(cur.idx) + 1, String(cur.kind), Number(cur.page_end), Number(cur.page_end), JSON.stringify(tailDoc), tail).lastInsertRowid)
    const inTail = { note: ids(db, "SELECT id FROM note WHERE segment_id = ? AND src_start >= ?", p.id, p.offset), comment: ids(db, "SELECT id FROM comment WHERE segment_id = ? AND side = 'source' AND src_start >= ?", p.id, p.offset) }
    moveBelonging(db, p.id, tailId, -shift, inTail)
    setBoxes(db, tailId, boxesOf(db, p.id))
    return {
      result: [segmentOut(db, p.id), segmentOut(db, tailId)],
      forward: { id: p.id, offset: p.offset, tailId },
      inverse: { name: "unsplit", params: { headId: p.id, tailId, offset: p.offset, doc: String(cur.source_doc), text, verified: cur.verified === 1, pageEnd: Number(cur.page_end), shift } },
      segmentIds: [p.id, tailId],
    }
  },

  /** The way back from a split: the tail's text, and all that belongs to it, back into the head. */
  unsplit(db, params) {
    const p = sent(Unsplit, "unsplit", params)
    const head = getSegment(db, p.headId)
    const tail = getSegment(db, p.tailId)
    moveBelonging(db, p.tailId, p.headId, p.shift)
    db.prepare("DELETE FROM segment WHERE id = ?").run(p.tailId)
    db.prepare("UPDATE segment SET source_doc = ?, source_text = ?, verified = ?, page_end = ?, updated_at = datetime('now') WHERE id = ?")
      .run(p.doc, p.text, p.verified ? 1 : 0, p.pageEnd, p.headId)
    shiftIdx(db, Number(head.chapter_id), Number(tail.idx), -1)
    return {
      result: segmentOut(db, p.headId),
      forward: p,
      inverse: { name: "splitSegment", params: { id: p.headId, offset: p.offset, tailId: p.tailId } },
      segmentIds: [p.headId, p.tailId],
    }
  },

  /** Join the next paragraph of the chapter to this one: its source after a space, its translation after this one's, its
   *  boxes page by page, and all that belonged to it. The merged paragraph is to be checked against the scan again. */
  mergeWithNext(db, params) {
    const p = sent(Merge, "mergeWithNext", params)
    const cur = getSegment(db, p.id)
    checkVersion(cur, p.expectVersion)
    const next = db.prepare("SELECT * FROM segment WHERE chapter_id = ? AND idx = ?").get(Number(cur.chapter_id), Number(cur.idx) + 1)
    if (!next) throw new RequestError(400, "mergeWithNext: there is no following paragraph in this chapter")
    const mergedDoc = mergeDocs(JSON.parse(String(cur.source_doc)) as Doc, JSON.parse(String(next.source_doc)) as Doc)
    const shift = String(cur.source_text).length + 1
    const translation = joinTranslations(cur, next)
    const headBoxes = boxesOf(db, p.id)
    const nextBoxes = boxesOf(db, Number(next.id))

    const moved = moveBelonging(db, Number(next.id), p.id, shift)
    // what was being typed into the next paragraph has nowhere to go: a draft is not part of the book
    db.prepare("DELETE FROM draft WHERE segment_id = ?").run(Number(next.id))
    db.prepare("DELETE FROM segment WHERE id = ?").run(Number(next.id))
    db.prepare(
      `UPDATE segment SET source_doc = ?, source_text = ?, page_end = ?, verified = 0, target_doc = ?, target_text = ?, status = ?,
                          updated_at = datetime('now') WHERE id = ?`,
    ).run(JSON.stringify(mergedDoc), docText(mergedDoc), Number(next.page_end), translation.doc, translation.text, translation.status, p.id)
    shiftIdx(db, Number(cur.chapter_id), Number(next.idx), -1)
    setBoxes(db, p.id, unionBoxes(headBoxes, nextBoxes))
    return {
      result: segmentOut(db, p.id),
      forward: { id: p.id },
      inverse: {
        name: "unmerge",
        params: {
          headId: p.id,
          head: { doc: String(cur.source_doc), text: String(cur.source_text), pageEnd: Number(cur.page_end), verified: cur.verified === 1, targetDoc: cur.target_doc as string | null, targetText: cur.target_text as string | null, status: String(cur.status), boxes: headBoxes },
          // the whole row, put back under its id
          next: { ...next },
          nextBoxes,
          moved,
          shift,
        },
      },
      segmentIds: [p.id, Number(next.id)],
    }
  },

  /** The way back from a merge: the next paragraph as it was, under its id, with all that was moved from it. */
  unmerge(db, params) {
    const p = sent(Unmerge, "unmerge", params)
    const cur = getSegment(db, p.headId)
    const nextId = Number(p.next.id)
    shiftIdx(db, Number(cur.chapter_id), Number(cur.idx), 1)
    const columns = Object.keys(p.next)
    db.prepare(`INSERT INTO segment(${columns.map((c) => `"${c}"`).join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`)
      .run(...columns.map((c) => p.next[c] as string | number | null))
    db.prepare(
      `UPDATE segment SET source_doc = ?, source_text = ?, page_end = ?, verified = ?, target_doc = ?, target_text = ?, status = ?,
                          updated_at = datetime('now') WHERE id = ?`,
    ).run(p.head.doc, p.head.text, p.head.pageEnd, p.head.verified ? 1 : 0, p.head.targetDoc, p.head.targetText, p.head.status, p.headId)
    moveBelonging(db, p.headId, nextId, -p.shift, p.moved as Moved)
    setBoxes(db, p.headId, p.head.boxes as Box[])
    setBoxes(db, nextId, p.nextBoxes as Box[])
    return {
      result: segmentOut(db, p.headId),
      forward: p,
      inverse: { name: "mergeWithNext", params: { id: p.headId } },
      segmentIds: [p.headId, nextId],
    }
  },

  /** Put a new paragraph after the one at `afterIdx` (-1: first) — a caption the import left out of a page, say. It has
   *  no OCR text and no boxes, and is not verified. Redo puts it back under the same id (`id`). */
  insertSegment(db, params) {
    const p = sent(Insert, "insertSegment", params)
    if (!p.text.trim()) throw new RequestError(400, "insertSegment: a paragraph needs some text")
    if (!db.prepare("SELECT 1 FROM chapter WHERE id = ?").get(p.chapterId)) throw new RequestError(404, `chapter ${p.chapterId} not found`)
    const count = Number(db.prepare("SELECT count(*) n FROM segment WHERE chapter_id = ?").get(p.chapterId)?.n)
    if (p.afterIdx < -1 || p.afterIdx >= count) throw new RequestError(400, `insertSegment: afterIdx must be -1 to ${count - 1}`)
    shiftIdx(db, p.chapterId, p.afterIdx, 1)
    const id = Number(db.prepare(
      `INSERT INTO segment(id, chapter_id, idx, kind, page_start, page_end, source_doc, source_text, ocr_text, verified, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, 0, 'untranslated')`,
    ).run(p.id ?? null, p.chapterId, p.afterIdx + 1, p.kind, p.pageNo, p.pageNo, JSON.stringify(textDoc(p.text)), p.text).lastInsertRowid)
    return {
      result: segmentOut(db, id),
      forward: { id, chapterId: p.chapterId, afterIdx: p.afterIdx, kind: p.kind, text: p.text, pageNo: p.pageNo },
      inverse: { name: "deleteSegment", params: { id } },
      segmentIds: [id],
    }
  },

  /** Take a paragraph away — the way back from an insert. One that anything belongs to is refused: merge it instead. */
  deleteSegment(db, params) {
    const p = sent(Delete, "deleteSegment", params)
    const cur = getSegment(db, p.id)
    const owned = BELONGING.filter((table) => db.prepare(`SELECT 1 FROM "${table}" WHERE segment_id = ? LIMIT 1`).get(p.id))
    if (owned.length) throw new RequestError(400, `deleteSegment: something belongs to it (${owned.join(", ")}); merge it instead`)
    db.prepare("DELETE FROM draft WHERE segment_id = ?").run(p.id)
    db.prepare("DELETE FROM segment WHERE id = ?").run(p.id)
    shiftIdx(db, Number(cur.chapter_id), Number(cur.idx), -1)
    return {
      result: null,
      forward: { id: p.id },
      inverse: { name: "insertSegment", params: { id: p.id, chapterId: Number(cur.chapter_id), afterIdx: Number(cur.idx) - 1, kind: String(cur.kind), text: String(cur.source_text), pageNo: Number(cur.page_start) } },
      segmentIds: [p.id],
    }
  },
}


const ids = (db: DatabaseSync, query: string, ...params: number[]) => db.prepare(query).all(...params).map((r) => Number(r.id))
