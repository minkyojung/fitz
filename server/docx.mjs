/** Render a manuscript (export.mjs) as a Word file. Word's own footnotes and endnotes carry the notes, so
 *  Word numbers them and a designer's InDesign import keeps them as notes. Paragraph kinds map to named
 *  styles and nothing else: fonts and sizes are the designer's. */

import {
  AlignmentType, Document, EndnotePosition, EndnoteReferenceRun, FootnotePosition, FootnoteReferenceRun, HeadingLevel,
  NoteNumberRestart, NumberFormat, Packer, Paragraph, SectionType, TextRun,
} from "docx"

/** Scheme → where each kind of note goes and how each stream is numbered. */
const SCHEME = {
  A: {
    author: "endnote", translator: "footnote",
    footnoteProperties: { numberFormat: { type: NumberFormat.CHICAGO }, restart: NoteNumberRestart.EACH_PAGE, position: FootnotePosition.PAGE_BOTTOM },
    endnoteProperties: { numberFormat: { type: NumberFormat.DECIMAL }, restart: NoteNumberRestart.EACH_SECTION, position: EndnotePosition.SECTION_END },
  },
  B: {
    author: "footnote", translator: "footnote",
    footnoteProperties: { numberFormat: { type: NumberFormat.DECIMAL }, restart: NoteNumberRestart.CONTINUOUS, position: FootnotePosition.PAGE_BOTTOM },
  },
  C: {
    author: "endnote", translator: "endnote",
    endnoteProperties: { numberFormat: { type: NumberFormat.DECIMAL }, restart: NoteNumberRestart.CONTINUOUS, position: EndnotePosition.SECTION_END },
  },
}

const STYLE = { paragraph: "Body", heading: "Heading1", blockquote: "Quote", caption: "Caption", verse: "Verse" }

const styles = {
  paragraphStyles: [
    { id: "Body", name: "Body", basedOn: "Normal", next: "Body", quickFormat: true, run: { size: 22 }, paragraph: { spacing: { after: 120, line: 320 } } },
    { id: "Quote", name: "Quote", basedOn: "Body", next: "Body", quickFormat: true, paragraph: { indent: { left: 720, right: 720 }, spacing: { after: 120 } } },
    { id: "Caption", name: "Caption", basedOn: "Body", next: "Body", quickFormat: true, run: { size: 18 }, paragraph: { alignment: AlignmentType.CENTER } },
    { id: "Verse", name: "Verse", basedOn: "Body", next: "Verse", quickFormat: true, paragraph: { indent: { left: 720 }, spacing: { after: 0 } } },
  ],
}

export async function renderDocx(m, { date = new Date() } = {}) {
  const scheme = SCHEME[m.scheme]
  const footnotes = {}
  const endnotes = {}
  let nextId = 1
  const noteRun = (note) => {
    const id = nextId++
    const content = { children: [new Paragraph({ children: [new TextRun({ text: note.body, language: note.lang === "en" ? { value: "en-US" } : { value: "ko-KR", eastAsia: "ko-KR" } })] })] }
    if (scheme[note.kind] === "footnote") { footnotes[id] = content; return new FootnoteReferenceRun(id) }
    endnotes[id] = content; return new EndnoteReferenceRun(id)
  }
  const runs = (block, untranslated) =>
    block.runs.map((r) => (r.note ? noteRun(r.note) : new TextRun({ text: r.text, italics: r.italic || undefined, highlight: untranslated ? "yellow" : undefined })))

  const sections = m.chapters.map((c) => {
    const children = []
    if (!c.titleFromHeading) children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(c.title)] }))
    for (const p of c.paragraphs) {
      for (const b of p.blocks) {
        const opts = p.kind === "heading" ? { heading: HeadingLevel.HEADING_1 } : { style: STYLE[p.kind] ?? "Body" }
        children.push(new Paragraph({ ...opts, children: runs(b, p.untranslated) }))
      }
    }
    return {
      properties: { type: SectionType.NEXT_PAGE, footnoteProperties: scheme.footnoteProperties, endnoteProperties: scheme.endnoteProperties },
      children,
    }
  })

  const doc = new Document({
    title: m.title,
    creator: m.author ?? undefined,
    description: `Exported by fitz on ${date.toISOString().slice(0, 10)}, note scheme ${m.scheme}`,
    styles,
    footnotes,
    endnotes,
    sections,
  })
  return Packer.toBuffer(doc)
}
