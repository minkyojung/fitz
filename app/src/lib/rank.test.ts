import assert from "node:assert/strict"
import { test } from "node:test"

import { buildCorpus, pairCount, wordCount } from "./corpus.ts"
import { confusionCandidates } from "./confusions.ts"
import { neighbours, rankCandidates } from "./rank.ts"

const BOOK = [
  "It was a brisk night in the winter of 1910. It was cold. It was late.",
  "He cleared the jungle and made his fortune. They cleared the land. Cleaned up later.",
  "Tell me the truth. To the isthmus and back.",
]
const corpus = buildCorpus(BOOK)
const dict = new Set(["it", "was", "a", "brisk", "night", "in", "the", "winter", "of", "cold", "late", "he", "cleared",
  "jungle", "and", "made", "his", "fortune", "they", "land", "cleaned", "up", "later", "tell", "me", "truth", "to",
  "isthmus", "back", "te", "tr", "tu", "ft", "cleaved", "leafed"])
const correct = (w: string) => dict.has(w.toLowerCase())
const hunspell = (w: string) => ({ Tt: ["Te", "To", "Tr", "Tu", "Ft"], cleafed: ["cleared", "cleaved", "leafed", "cleaned"] })[w] ?? []

test("corpus counts words and pairs", () => {
  assert.equal(wordCount(corpus, "It"), 3)
  assert.equal(pairCount(corpus, "it", "was"), 3)
  assert.equal(pairCount(corpus, "cleared", "the"), 2)
})

test("confusion table proposes It for Tt and cleared for cleafed", () => {
  assert.ok(confusionCandidates("Tt").some((c) => c.word === "It"))
  assert.ok(confusionCandidates("cleafed").some((c) => c.word === "cleared"))
})

test("ranking puts the contextually right word first", () => {
  const text = "Tt was a brisk night"
  const r1 = rankCandidates("Tt", neighbours(text, 0, 2), hunspell, correct, corpus)
  assert.equal(r1[0].word, "It")
  const text2 = "where he cleafed the jungle"
  const r2 = rankCandidates("cleafed", neighbours(text2, 9, 16), hunspell, correct, corpus)
  assert.equal(r2[0].word, "cleared")
  assert.ok(r2.map((r) => r.word).includes("cleaned"))
})

test("candidates that are not words are dropped; neighbours skip punctuation", () => {
  assert.deepEqual(neighbours("night. Tt was", 7, 9), { prev: "night", next: "was" })
  const r = rankCandidates("Zemurray", { prev: "Sam", next: "spoke" }, () => ["Zemurra"], correct, corpus)
  assert.deepEqual(r, [])
})
