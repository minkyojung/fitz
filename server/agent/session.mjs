// The only place that starts Claude Code (docs/agent.md §1–2). It decides how a session starts and nothing
// about what its messages mean — fold.mjs does that. Every option is set here on purpose: the SDK's defaults
// are the terminal's, and several are wrong for an editor.
import { randomUUID } from "node:crypto"
import { mkdirSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

import { query } from "@anthropic-ai/claude-agent-sdk"

import { READ_TOOL_NAMES, WRITE_TOOL_NAMES, fitzServer } from "./tools.mjs"

/** The session's working folder: empty, the app's own, away from the repository and the PDF. Claude Code keys
 *  its session files by it (~/.claude/projects/<this path>/). */
export const AGENT_CWD = join(homedir(), ".fitz", "agent")

export const READ_TOOLS = READ_TOOL_NAMES.map((name) => `mcp__fitz__${name}`)
export const WRITE_TOOLS = WRITE_TOOL_NAMES.map((name) => `mcp__fitz__${name}`)

export const SYSTEM_PROMPT = `You work inside fitz, the editor in which a professional translator is translating an English nonfiction book into Korean. You are the translator's colleague: you read the book through your tools and help with meaning, nuance, register and Korean wording.

The book is reachable only through the fitz tools: book (title, author, chapters), read (paragraphs with the source, the translation so far, notes, comments and the glossary terms they mention), glossary (the book's agreed Korean forms) and search (where else a phrase appears). You cannot see the scanned pages or the PDF and must not ask for them.

You can also write: set_translation, set_glossary_term, add_comment, add_translator_note. The translator is asked before each write and may decline; a declined write is the translator's decision, not an error to work around. Write only what the translator asked for or agreed to; when unsure, propose in your reply instead.

How to work:
- Read before you answer. When asked about a paragraph, read it with a few paragraphs around it; a sentence's meaning often depends on what came before. When read returns \`next\`, call it again with exactly that to continue.
- Refer to paragraphs by id, like ¶123, so the translator can find them.
- Respect the glossary. Where a term has an agreed Korean form, use it; if you think it is wrong, say so rather than silently using another.
- Reply in the language the translator writes to you in (usually Korean). Quote the English when you discuss a phrase.
- Be concrete and brief: what the words mean here and why, then Korean options and when each fits.`

/** The environment without what a Claude Code session hands its children. Started from inside one (a terminal in
 *  Octave, Claude Code's own Bash), the server would otherwise pass on that session's id, its messaging socket and
 *  token, and its effort. CLAUDE_CODE_USE_* stay: they choose the person's cloud provider. */
export const ownEnv = (env) => Object.fromEntries(Object.entries(env).filter(([k]) =>
  !(k === "CLAUDECODE" || k === "CLAUDE_PID" || k === "CLAUDE_EFFORT" || k === "CLAUDE_AGENT_SDK_VERSION" || (k.startsWith("CLAUDE_CODE_") && !k.startsWith("CLAUDE_CODE_USE_")))))

/** Prompts for one conversation, fed to query() as streaming input: the session stays open between turns. */
function inbox() {
  const queue = []
  let wake = null
  let closed = false
  return {
    push(msg) { queue.push(msg); wake?.(); wake = null },
    close() { closed = true; wake?.(); wake = null },
    async *[Symbol.asyncIterator]() {
      for (;;) {
        if (queue.length) { yield queue.shift(); continue }
        if (closed) return
        await new Promise((resolve) => { wake = resolve })
      }
    },
  }
}

/** One conversation = one query(). `messages` is the SDK's stream; `send` returns the uuid the echo will carry.
 *  `ask(toolName, input, { signal })` is the host's: it puts a write to the translator and resolves with Claude Code's
 *  PermissionResult. */
export function openSession({ db, resume, model, effort, ask, cwd = AGENT_CWD }) {
  mkdirSync(cwd, { recursive: true })
  const input = inbox()
  const q = query({
    prompt: input,
    options: {
      cwd,
      resume,                                                    // a session id to go on with; undefined starts a new one
      model,                                                     // explicit: the CLI's default model is the terminal's choice
      effort,
      thinking: { type: "adaptive", display: "summarized" },     // Opus 5.5 always thinks; the default "omitted" sends empty blocks
      systemPrompt: SYSTEM_PROMPT,                               // a string replaces Claude Code's coding prompt
      settingSources: [],                                        // the person's ~/.claude (CLAUDE.md, hooks, MCP servers) stays out
      // what settingSources does not reach (measured, 2.1.302): the person's claude.ai connectors (Gmail, Drive, …)
      // joined from the second request on, 28,000 tokens of tools; their skills were listed; auto memory was on
      strictMcpConfig: true,                                     // only the servers given here
      skills: [],
      settings: { disableClaudeAiConnectors: true, autoMemoryEnabled: false, disableBundledSkills: true },
      tools: [],                                                 // no Read/Edit/Bash/Web: the PDF and page images cannot be opened
      mcpServers: { fitz: fitzServer(db) },
      allowedTools: READ_TOOLS,                                  // reading never asks
      permissionMode: "default",                                 // not bypass: every write is asked about
      canUseTool: async (toolName, input, options) =>            // writes go to the translator; nothing else is offered
        WRITE_TOOLS.includes(toolName) ? ask(toolName, input, options) : { behavior: "deny", message: `${toolName} is not available in this conversation.` },
      includePartialMessages: true,                              // text as it is written
      extraArgs: { "replay-user-messages": null },               // the echo of what was sent, with its uuid (measured: off by default)
      env: { ...ownEnv(process.env), CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS: "1" },  // env replaces the whole environment; idle/running state
      stderr: (data) => process.stderr.write(`[claude] ${data}`),
    },
  })
  return {
    messages: q,
    send(text) {
      const uuid = randomUUID()
      input.push({ type: "user", message: { role: "user", content: text }, parent_tool_use_id: null, uuid })
      return uuid
    },
    interrupt: () => q.interrupt(),
    close() { input.close(); q.close() },
  }
}
