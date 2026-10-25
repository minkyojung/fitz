import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"

import { DatabaseSync } from "node:sqlite"

import { DEFAULTS, READ_TOOLS, SYSTEM_PROMPT, TASK_SYSTEM_PROMPT, WEB_TOOLS, WRITE_TOOLS, closeWarming, openSession, ownEnv, startWarming } from "./session.mjs"
import { WRITE_TOOL_NAMES } from "./tools.mjs"

test("a conversation's prompt names the web and write tools it is given; a task's prompt names none, having none", () => {
  for (const name of [...WRITE_TOOL_NAMES, ...WEB_TOOLS]) {
    assert.ok(SYSTEM_PROMPT.includes(name), `the conversation prompt does not name ${name}`)
    assert.ok(!TASK_SYSTEM_PROMPT.includes(name), `the task prompt names ${name}`)
  }
})

test("ownEnv drops what a parent Claude Code session hands its children, and keeps the rest", () => {
  const env = ownEnv({
    HOME: "/h", USER: "u", PATH: "/bin", ANTHROPIC_API_KEY: "k", CLAUDE_CONFIG_DIR: "/c", CLAUDE_CODE_USE_BEDROCK: "1",
    CLAUDECODE: "1", CLAUDE_PID: "9", CLAUDE_EFFORT: "xhigh", CLAUDE_AGENT_SDK_VERSION: "0.3.296",
    CLAUDE_CODE_SESSION_ID: "s", CLAUDE_CODE_MESSAGING_SOCKET: "/tmp/x.sock", CLAUDE_CODE_MESSAGING_TOKEN: "t", CLAUDE_CODE_CHILD_SESSION: "1",
  })
  assert.deepEqual(env, { HOME: "/h", USER: "u", PATH: "/bin", ANTHROPIC_API_KEY: "k", CLAUDE_CONFIG_DIR: "/c", CLAUDE_CODE_USE_BEDROCK: "1" })
})

for (const name of ["nuance", "translate"]) {
  test(`the recorded ${name} session offered the model fitz tools and nothing else`, () => {
    const frames = readFileSync(new URL(`./fixtures/${name}.jsonl`, import.meta.url), "utf8").trim().split("\n").map((l) => JSON.parse(l))
    const init = frames.find((m) => m.type === "system" && m.subtype === "init")
    assert.ok(init.tools.every((t) => [...READ_TOOLS, ...WRITE_TOOLS].includes(t)), init.tools.join(", "))
    assert.ok(READ_TOOLS.every((t) => init.tools.includes(t)))
    assert.deepEqual(init.mcp_servers.map((s) => s.name), ["fitz"])
    assert.equal(init.memory_paths?.auto, undefined)
    // every model request stayed small: no connector tools joined later (they once added 28,000 tokens)
    const prompts = [...new Map(frames.filter((m) => m.type === "assistant").map((m) => [m.message.id, m.message.usage])).values()]
      .map((u) => u.input_tokens + u.cache_creation_input_tokens + u.cache_read_input_tokens)
    for (const n of prompts) assert.ok(n < 8000, `a request carried ${n} prompt tokens`)
  })
}

test("the recorded websearch session offered the fitz tools and web search, and searching never asked", () => {
  const frames = readFileSync(new URL("./fixtures/websearch.jsonl", import.meta.url), "utf8").trim().split("\n").map((l) => JSON.parse(l))
  const init = frames.find((m) => m.type === "system" && m.subtype === "init")
  assert.deepEqual([...init.tools].sort(), [...READ_TOOLS, ...WRITE_TOOLS, ...WEB_TOOLS].sort())
  assert.ok(frames.some((m) => m.type === "assistant" && m.message.content.some((b) => b.type === "tool_use" && b.name === "WebSearch")))
  assert.ok(!frames.some((m) => m.type === "system" && m.subtype === "session_state_changed" && m.state === "requires_action"))
})

for (const name of ["review", "typos"]) {
  test(`the recorded ${name} session was offered the read tools and the tool its answer goes in, nothing that writes`, () => {
    const frames = readFileSync(new URL(`./fixtures/${name}.jsonl`, import.meta.url), "utf8").trim().split("\n").map((l) => JSON.parse(l))
    const init = frames.find((m) => m.type === "system" && m.subtype === "init")
    assert.deepEqual([...init.tools].sort(), [...READ_TOOLS, "StructuredOutput"].sort())
    assert.ok(frames.find((m) => m.type === "result").structured_output)
  })
}

// --- the query a conversation opens (docs/agent.md §30): started now, or the one started ahead

const gatsby = () => { const db = new DatabaseSync(":memory:"); db.exec(readFileSync(new URL("../../db/schema.sql", import.meta.url), "utf8")); db.exec(readFileSync(new URL("./fixtures/gatsby.sql", import.meta.url), "utf8")); return db }
/** A stand-in query(): echoes each prompt it is fed as a user message, then a result. Records its options. */
function fakeQuery() {
  const calls = []
  const query = ({ prompt, options }) => {
    calls.push(options)
    const q = (async function* () { for await (const m of prompt) { yield { type: "user", isReplay: true, uuid: m.uuid, message: m.message }; yield { type: "result", subtype: "success", total_cost_usd: 0 } } })()
    q.interrupt = async () => {}; q.setModel = async (m) => calls.push({ setModel: m }); q.applyFlagSettings = async (f) => calls.push({ flags: f })
    return q
  }
  return { calls, query }
}

test("a conversation started now: the first message reaches the query, and its stream flows back", async () => {
  const { calls, query } = fakeQuery()
  const s = openSession({ db: gatsby(), model: "claude-haiku-5-5", effort: "low", ask: async () => ({ behavior: "deny" }), wrote: () => {}, cwd: "/tmp/fitz-session-test", sdk: { query } })
  const uuid = s.send("¶4는?")
  const seen = []
  for await (const m of s.messages) { seen.push(m); if (m.type === "result") break }
  assert.deepEqual(seen.map((m) => m.type), ["user", "result"])
  assert.equal(seen[0].uuid, uuid)
  assert.deepEqual([calls[0].model, calls[0].effort, calls[0].resume], ["claude-haiku-5-5", "low", undefined])
  await s.close()
})

test("a new free conversation takes the one started ahead, switched first when its model or effort differ; a resumed one does not", async () => {
  const db = gatsby()
  const { calls, query } = fakeQuery()
  const started = []
  const startup = async ({ options }) => { started.push(options); return { query: (prompt) => query({ prompt, options }), close() {} } }
  startWarming(db, { cwd: "/tmp/fitz-session-test", start: startup })
  try {
    const a = openSession({ db, model: "claude-haiku-5-5", effort: "low", ask: async () => ({ behavior: "deny" }), wrote: () => {}, cwd: "/tmp/fitz-session-test", sdk: { query } })
    a.send("q")
    for await (const m of a.messages) if (m.type === "result") break
    assert.deepEqual([started[0].model, started[0].effort], [DEFAULTS.model, DEFAULTS.effort], "the one ahead has the defaults")
    assert.deepEqual(calls.slice(1, 3), [{ setModel: "claude-haiku-5-5" }, { flags: { effortLevel: "low" } }], "switched before the first message")
    const b = openSession({ db, resume: "sess-1", model: DEFAULTS.model, effort: DEFAULTS.effort, ask: async () => ({ behavior: "deny" }), wrote: () => {}, cwd: "/tmp/fitz-session-test", sdk: { query } })
    b.send("more")
    for await (const m of b.messages) if (m.type === "result") break
    assert.equal(calls.at(-1).resume, "sess-1", "a resumed conversation starts its own")
    await a.close(); await b.close()
  } finally { closeWarming() }
})
