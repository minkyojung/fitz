// The agent's set tasks besides free conversation (docs/agent.md §4): what Claude is asked about a chapter, and the
// shape its answer must take (outputFormat). Claude only finds; the translator decides each suggestion
// (suggestions.mjs). These conversations get the read tools only.
import { z } from "zod"

const suggestion = {
  segmentId: z.number().int().describe("The paragraph id, as read gives it"),
  quote: z.string().min(1).describe("The exact words to change, copied from the paragraph as it stands; they must occur in it exactly once"),
  replacement: z.string().describe("What replaces exactly those words"),
  why: z.string().min(1).describe("Why, briefly, in Korean"),
}

const READ_THE_CHAPTER = (c) =>
  `Read chapter ${c.idx + 1}, "${c.title}", with read({ chapterId: ${c.id} }); when read returns \`next\`, call it again with exactly that until the chapter is done.`
const EXACT = "Each quote must be copied exactly, character for character, and occur only once in its paragraph; quote more of the sentence if a shorter quote would repeat."
const QUOTES = `${EXACT} A replacement replaces only the quoted words.`

export const TASKS = {
  review: {
    side: "target",
    model: "claude-sonnet-5-5",
    effort: "low",
    schema: z.object({
      suggestions: z.array(z.object({ ...suggestion, level: z.enum(["high", "medium", "low"]).describe("high: the meaning is wrong; medium: unnatural or inconsistent; low: a better choice") })),
    }),
    prompt: (c) => [
      `Review the Korean translation of this chapter against the English source.`,
      READ_THE_CHAPTER(c),
      `Look only at paragraphs that have a translation. Report what a careful editor would: meaning that is wrong or missing, phrasing that reads as translationese, the glossary's agreed forms not used, inconsistency with the rest of the chapter. Do not report matters of taste, and do not rewrite whole paragraphs.`,
      `The quote is words of the Korean translation. ${QUOTES}`,
      `Give the reasons in Korean. If nothing needs changing, return an empty list.`,
    ].join("\n\n"),
  },
  typos: {
    side: "source",
    model: "claude-sonnet-5-5",
    effort: "low",
    schema: z.object({ suggestions: z.array(z.object(suggestion)) }),
    prompt: (c) => [
      `Find words in this chapter's English source that the OCR of the scanned book most likely misread.`,
      READ_THE_CHAPTER(c),
      `Look for real words that are wrong in their context (reverse for reserve, boars for bores), letters confused by scanning (rn and m, l and 1, cl and d, li and h), and broken or joined words. Do not report the author's spelling, style or word choices, British spellings, or names you merely do not know.`,
      `The quote is the misread word or words as they stand in the English source; the replacement is what the printed page most likely says. ${QUOTES}`,
      `Give the reasons in Korean. If you find nothing, return an empty list.`,
    ].join("\n\n"),
  },
}

export const TASK_NAMES = Object.keys(TASKS)
/** A task reads a chapter and answers once; these stop one that runs away (docs/agent.md §4). */
export const TASK_LIMITS = { maxTurns: 60, maxBudgetUsd: 5 }

/** Session's quiz (docs/session.md): not a task a page starts on a chapter but one the server starts every evening on
 *  the paragraphs whose translation changed, so it is kept out of TASKS (what a page may start). Measured (§8): Opus
 *  makes wrong options that are real senses of the same words, which Sonnet mostly does not; Claude puts the right
 *  option first, so the server shuffles them. */
export const DRILL = {
  model: "claude-opus-5-5",
  effort: "medium",
  limits: { cards: 20, challenges: 6, perParagraph: 3 },
  schema: z.object({
    cards: z.array(z.object({
      segmentId: suggestion.segmentId,
      kind: z.enum(["meaning", "nuance"]),
      quote: z.string().min(1).describe("The English word or phrase, copied exactly from the paragraph's source; it must occur in it exactly once"),
      question: z.string().min(1).describe("The question, in Korean"),
      options: z.array(z.string().min(1)).length(4).describe("Four options in Korean, exactly one of them right"),
      answer: z.number().int().min(0).max(3).describe("The index of the right option, 0 to 3"),
      why: z.string().min(1).describe("Why, briefly, in Korean: what in the context settles it, quoting the English"),
    })),
    challenges: z.array(z.object({
      segmentId: suggestion.segmentId,
      quote: z.string().min(1).describe("The exact words of the Korean translation in question; they must occur in it exactly once"),
      proposal: z.string().min(1).describe("What you would put instead of exactly those words"),
      question: z.string().min(1).describe("The challenge put to the translator, in Korean"),
      why: z.string().min(1).describe("Why, briefly, in Korean: what in the source settles it, quoting the English"),
    })),
  }),
  /** `ids`: the paragraphs to read; `picks`: words the translator chose or asked about ({ segmentId, quote });
   *  `known`: expressions they know; `existing`: expressions these paragraphs already have cards on. */
  prompt: ({ ids, picks = [], known = [], existing = [] }) => [
    `The translator wants to be quizzed, until they know them, on things from their recent work: the paragraphs whose translation changed, ${ids.map((i) => `¶${i}`).join(", ")}.`,
    `Read them with read({ ids: [${ids.join(", ")}] }); when read returns \`next\`, call it again with exactly that until you have them all.`,
    `The translator is a professional who translates English into Korean, a native speaker of Korean. Ask about what such a translator could well not know or could get subtly wrong — not what any fluent reader of English knows.`,
    `Make cards of two kinds:\n- meaning: an English word or phrase whose sense here is not the one a dictionary gives first; an idiom, a phrasal verb, slang, a period or regional usage, an allusion. The question asks what it means here. The four options are Korean; the wrong ones are other real senses of the same words, or readings this context rules out.\n- nuance: a word whose exact shade — tone, connotation, register, irony — decides the Korean. The question asks which Korean comes closest to it here. The four options are Korean words or phrases close in meaning; exactly one fits clearly better, for a reason in the sentence. If the choice would be a matter of taste, make no card.`,
    `For both, the quote is the English as it stands in the paragraph's source. ${EXACT} Exactly one option is right; the options are distinct and alike in length and form — the right one is not the longest or the most detailed — and the question does not give the answer away. Do not ask about names, numbers or dates.`,
    `Also challenges: where a paragraph's Korean translation makes a choice worth questioning — a meaning shifted, a nuance lost, a register that does not match — quote the Korean words, give what you would put instead, and put the question to the translator in Korean: would they keep theirs? Do not say who wrote the translation. Not matters of taste, not typos. The quote is words of the Korean translation. ${EXACT} The proposal replaces only the quoted words.`,
    picks.length ? `The translator also asked to be quizzed on these; make a meaning or nuance card on each, quoting it as it stands: ${picks.map((p) => `¶${p.segmentId} “${p.quote}”`).join("; ")}.` : "",
    known.length ? `The translator already knows these; make no card on them: ${known.map((q) => `“${q}”`).join("; ")}.` : "",
    existing.length ? `These already have cards; do not ask about them again: ${existing.map((q) => `“${q}”`).join("; ")}.` : "",
    `Write questions, options and reasons in Korean.`,
    `At most ${DRILL.limits.cards} cards and ${DRILL.limits.challenges} challenges, and at most ${DRILL.limits.perParagraph} cards on one paragraph. Fewer good ones are better than weak ones; if nothing is worth asking, return empty lists.`,
  ].filter(Boolean).join("\n\n"),
}

const shapeOf = (task) => (task === "drill" ? DRILL : TASKS[task]).schema
/** What query() takes as outputFormat for a task: its schema as JSON Schema draft-07, the version the SDK validates. */
export const outputFormatOf = (task) => ({ type: "json_schema", schema: z.toJSONSchema(shapeOf(task), { target: "draft-7" }) })

/** Claude's answer checked again here: it came from a model. Throws with what is wrong. */
export function parseAnswer(task, answer) {
  const parsed = TASKS[task].schema.safeParse(answer)
  if (!parsed.success) throw new Error(`the ${task} answer does not have the agreed shape: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`)
  return parsed.data.suggestions
}
