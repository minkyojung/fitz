import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"

import { READ_TOOLS, ownEnv } from "./session.mjs"

test("ownEnv drops what a parent Claude Code session hands its children, and keeps the rest", () => {
  const env = ownEnv({
    HOME: "/h", USER: "u", PATH: "/bin", ANTHROPIC_API_KEY: "k", CLAUDE_CONFIG_DIR: "/c", CLAUDE_CODE_USE_BEDROCK: "1",
    CLAUDECODE: "1", CLAUDE_PID: "9", CLAUDE_EFFORT: "xhigh", CLAUDE_AGENT_SDK_VERSION: "0.3.296",
    CLAUDE_CODE_SESSION_ID: "s", CLAUDE_CODE_MESSAGING_SOCKET: "/tmp/x.sock", CLAUDE_CODE_MESSAGING_TOKEN: "t", CLAUDE_CODE_CHILD_SESSION: "1",
  })
  assert.deepEqual(env, { HOME: "/h", USER: "u", PATH: "/bin", ANTHROPIC_API_KEY: "k", CLAUDE_CONFIG_DIR: "/c", CLAUDE_CODE_USE_BEDROCK: "1" })
})

test("the recorded session offered the model the four fitz tools and nothing else", () => {
  const frames = readFileSync(new URL("./fixtures/nuance.jsonl", import.meta.url), "utf8").trim().split("\n").map((l) => JSON.parse(l))
  const init = frames.find((m) => m.type === "system" && m.subtype === "init")
  assert.deepEqual([...init.tools].sort(), [...READ_TOOLS].sort())
  assert.deepEqual(init.mcp_servers.map((s) => s.name), ["fitz"])
  assert.equal(init.memory_paths?.auto, undefined)
  // every model request stayed small: no connector tools joined later (they once added 28,000 tokens)
  const prompts = [...new Map(frames.filter((m) => m.type === "assistant").map((m) => [m.message.id, m.message.usage])).values()]
    .map((u) => u.input_tokens + u.cache_creation_input_tokens + u.cache_read_input_tokens)
  for (const n of prompts) assert.ok(n < 8000, `a request carried ${n} prompt tokens`)
})
