/** Word and bigram counts over the book's own text: the cheapest, most relevant language model we have. */

export interface Corpus {
  unigram: Map<string, number>
  bigram: Map<string, number> // "prev next" (lowercased)
  total: number
}

export const tokenize = (text: string): string[] => text.toLowerCase().match(/[a-z][a-z’']*[a-z]|[a-z]/g) ?? []

export function buildCorpus(texts: Iterable<string>): Corpus {
  const unigram = new Map<string, number>()
  const bigram = new Map<string, number>()
  let total = 0
  for (const t of texts) {
    const words = tokenize(t)
    for (let i = 0; i < words.length; i++) {
      unigram.set(words[i], (unigram.get(words[i]) ?? 0) + 1)
      total++
      if (i > 0) {
        const key = `${words[i - 1]} ${words[i]}`
        bigram.set(key, (bigram.get(key) ?? 0) + 1)
      }
    }
  }
  return { unigram, bigram, total }
}

export const wordCount = (c: Corpus, w: string) => c.unigram.get(w.toLowerCase()) ?? 0
export const pairCount = (c: Corpus, a: string, b: string) => c.bigram.get(`${a.toLowerCase()} ${b.toLowerCase()}`) ?? 0
