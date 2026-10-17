import assert from "node:assert/strict"
import { test } from "node:test"
import JSZip from "jszip"

import { renderDocx } from "./docx.mjs"

const note = (id, kind, body, lang = "ko") => ({ note: { id, kind, body, lang } })
const manuscript = (scheme) => ({
  title: "The Fish", author: "Rich Cohen", scheme,
  chapters: [
    { id: 1, idx: 0, title: "Selma", titleFromHeading: true, paragraphs: [
      { segmentId: 1, kind: "heading", untranslated: false, blocks: [{ runs: [{ text: "셀마", italic: false }] }] },
      { segmentId: 2, kind: "paragraph", untranslated: false, blocks: [
        { runs: [{ text: "제무레이는 ", italic: false }, { text: "좋은 일자리", italic: true }, note(1, "author", "Family interview, 2010.", "en"), { text: "를 약속했다.", italic: false }] },
        { runs: [{ text: "통상 임금", italic: false }, note(3, "translator", "일당은 25센트였다."), { text: "의 열 배였다.", italic: false }, note(2, "author", "포춘, 1933.")] },
      ] },
      { segmentId: 3, kind: "blockquote", untranslated: true, blocks: [{ runs: [{ text: "Within months.", italic: false }] }] },
    ] },
    { id: 2, idx: 1, title: "Ripes", titleFromHeading: false, paragraphs: [
      { segmentId: 4, kind: "paragraph", untranslated: false, blocks: [{ runs: [{ text: "익은 바나나.", italic: false }] }] },
    ] },
  ],
  warnings: [], stats: {},
})
const count = (xml, re) => (xml.match(re) ?? []).length
async function parts(scheme) {
  const zip = await JSZip.loadAsync(await renderDocx(manuscript(scheme)))
  const read = async (name) => (zip.file(name) ? await zip.file(name).async("string") : "")
  return { document: await read("word/document.xml"), footnotes: await read("word/footnotes.xml"), endnotes: await read("word/endnotes.xml") }
}

test("scheme A: author's notes are endnotes, translator's notes chicago-symbol footnotes; one section per chapter", async () => {
  const { document, footnotes, endnotes } = await parts("A")
  assert.equal(count(document, /<w:endnoteReference /g), 2)
  assert.equal(count(document, /<w:footnoteReference /g), 1)
  assert.ok(endnotes.includes("Family interview, 2010.") && endnotes.includes("포춘, 1933."))
  assert.ok(footnotes.includes("일당은 25센트였다."))
  assert.equal(count(document, /<w:sectPr>/g), 2)
  assert.ok(document.includes('w:val="chicago"'))
  assert.ok(document.includes('<w:numRestart w:val="eachSect"/>'))
})

test("schemes B and C put every note in one stream", async () => {
  const b = await parts("B")
  assert.equal(count(b.document, /<w:footnoteReference /g), 3); assert.equal(count(b.document, /<w:endnoteReference /g), 0)
  const c = await parts("C")
  assert.equal(count(c.document, /<w:endnoteReference /g), 3); assert.equal(count(c.document, /<w:footnoteReference /g), 0)
})

test("paragraph styles, italics, a highlighted untranslated paragraph, a TOC title only when there is no heading, no empty paragraphs", async () => {
  const { document } = await parts("A")
  assert.ok(document.includes('<w:pStyle w:val="Heading1"/>'))
  assert.ok(document.includes('<w:pStyle w:val="Quote"/>'))
  assert.equal(count(document, /<w:pStyle w:val="Body"\/>/g), 3) // two translated blocks + chapter 2
  assert.ok(document.includes("<w:i/>"))
  assert.ok(document.includes('<w:highlight w:val="yellow"/>'))
  assert.ok(document.includes("Ripes") && !document.includes("Selma")) // chapter 1's heading "셀마" stands in for its title
  assert.ok(!/<w:p\/>|<w:p><\/w:p>/.test(document))
})
