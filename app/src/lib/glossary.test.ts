import assert from "node:assert/strict"
import { test } from "node:test"

import { findTerms, missingTerms, type GlossaryEntry } from "./glossary.ts"

const g: GlossaryEntry[] = [
  { id: 1, term: "Zemurray", translation: "제무레이", aliases: "샘 제무레이", kind: "person" },
  { id: 2, term: "United Fruit", translation: "유나이티드 프루트", aliases: "", kind: "org" },
  { id: 3, term: "Cuyamel", translation: "", aliases: "", kind: "place" },
  { id: 4, term: "Fruit", translation: "과일", aliases: "", kind: "other" },
]

test("finds whole words case-insensitively with possessive/plural tails; longer terms win overlaps", () => {
  const text = "Zemurray's men met United Fruit at Cuyamel. ZEMURRAY laughed. Fruitful."
  const hits = findTerms(text, g)
  assert.deepEqual(hits.map((h) => [h.entry.term, text.slice(h.start, h.end)]), [
    ["Zemurray", "Zemurray's"], ["United Fruit", "United Fruit"], ["Cuyamel", "Cuyamel"], ["Zemurray", "ZEMURRAY"],
  ])
})

test("flags terms whose agreed form (or alias) is absent from the target; untranslated entries and empty targets are skipped", () => {
  const text = "Zemurray met United Fruit at Cuyamel."
  const hits = findTerms(text, g)
  assert.deepEqual(missingTerms(hits, "제무라이가 유나이티드 프루트를 만났다.").map((e) => e.term), ["Zemurray"])
  assert.deepEqual(missingTerms(hits, "샘 제무레이는 유나이티드 프루트를 만났다.").map((e) => e.term), [])
  assert.deepEqual(missingTerms(hits, "").map((e) => e.term), [])
})
