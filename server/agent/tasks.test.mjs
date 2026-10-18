import assert from "node:assert/strict"
import { test } from "node:test"

import { TASKS, TASK_NAMES, outputFormatOf, parseAnswer } from "./tasks.mjs"

const chapter = { id: 7, idx: 2, title: "The Fruit Jobber" }

test("two tasks: the review works on the translation, the OCR hunt on the source", () => {
  assert.deepEqual(TASK_NAMES, ["review", "typos"])
  assert.deepEqual([TASKS.review.side, TASKS.typos.side], ["target", "source"])
})

test("each prompt names the chapter and how to read all of it", () => {
  for (const name of TASK_NAMES) {
    const p = TASKS[name].prompt(chapter)
    assert.match(p, /chapter 3, "The Fruit Jobber"/)
    assert.match(p, /read\(\{ chapterId: 7 \}\)/)
    assert.match(p, /next/)
    assert.match(p, /exactly once|only once/)
    assert.match(p, /Korean/)
  }
})

test("the output format is the schema as JSON Schema draft-07, with every field required", () => {
  const { type, schema } = outputFormatOf("review")
  assert.equal(type, "json_schema")
  assert.equal(schema.$schema, "http://json-schema.org/draft-07/schema#")
  const item = schema.properties.suggestions.items
  assert.deepEqual([...item.required].sort(), ["level", "quote", "replacement", "segmentId", "why"])
  assert.deepEqual(item.properties.level.enum, ["high", "medium", "low"])
  assert.equal(outputFormatOf("typos").schema.properties.suggestions.items.properties.level, undefined)
})

test("an answer is checked again on arrival: the right shape passes, anything else is refused with why", () => {
  const ok = { suggestions: [{ segmentId: 3, quote: "유리한 조건을 가진", replacement: "좋은 환경에서 자란", why: "혜택", level: "low" }] }
  assert.deepEqual(parseAnswer("review", ok), ok.suggestions)
  assert.deepEqual(parseAnswer("typos", { suggestions: [] }), [])
  assert.throws(() => parseAnswer("review", { suggestions: [{ segmentId: 3, quote: "x", replacement: "y", why: "z", level: "urgent" }] }), /level/)
  assert.throws(() => parseAnswer("typos", { suggestions: [{ segmentId: "3", quote: "x", replacement: "y", why: "z" }] }), /segmentId/)
  assert.throws(() => parseAnswer("typos", { findings: [] }), /suggestions/)
})
