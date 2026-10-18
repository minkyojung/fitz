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
const QUOTES = "Each quote must be copied exactly, character for character, and occur only once in its paragraph; quote more of the sentence if a shorter quote would repeat. A replacement replaces only the quoted words."

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

/** What query() takes as outputFormat for a task: its schema as JSON Schema draft-07, the version the SDK validates. */
export const outputFormatOf = (task) => ({ type: "json_schema", schema: z.toJSONSchema(TASKS[task].schema, { target: "draft-7" }) })

/** Claude's answer checked again here: it came from a model. Throws with what is wrong. */
export function parseAnswer(task, answer) {
  const parsed = TASKS[task].schema.safeParse(answer)
  if (!parsed.success) throw new Error(`the ${task} answer does not have the agreed shape: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`)
  return parsed.data.suggestions
}
