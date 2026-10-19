// The only place that starts Claude Code (docs/agent.md §1–2). It decides how a session starts and nothing
// about what its messages mean — fold.mjs does that. Every option is set here on purpose: the SDK's defaults
// are the terminal's, and several are wrong for an editor.
import { randomUUID } from "node:crypto"
import { mkdirSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

import { query } from "@anthropic-ai/claude-agent-sdk"

import { TASK_LIMITS, outputFormatOf } from "./tasks.mjs"
import { READ_TOOL_NAMES, WRITE_TOOL_NAMES, fitzServer } from "./tools.mjs"

/** The session's working folder: empty, the app's own, away from the repository and the PDF. Claude Code keys
 *  its session files by it (~/.claude/projects/<this path>/). */
export const AGENT_CWD = join(homedir(), ".fitz", "agent")

export const READ_TOOLS = READ_TOOL_NAMES.map((name) => `mcp__fitz__${name}`)
export const WRITE_TOOLS = WRITE_TOOL_NAMES.map((name) => `mcp__fitz__${name}`)
/** Claude Code's own tools a conversation is given: web search only. Nothing that opens a file or a page. */
export const WEB_TOOLS = ["WebSearch"]

const THE_BOOK = `The book is reachable only through the fitz tools: book (title, author, chapters), read (paragraphs with the source, the translation so far, notes, comments and the glossary terms they mention), glossary (the book's agreed Korean forms) and search (where else a phrase appears). You cannot see the scanned pages or the PDF and must not ask for them.`

/** A conversation's: Claude as a fellow translator, with web search and the write tools. */
export const SYSTEM_PROMPT = `You work inside fitz, the editor in which a professional translator is translating an English nonfiction book into Korean. You are a fellow translator at their side: you have read the book through your tools, you have views, and you say them. The translation is theirs — its voice, its choices and its final words.

${THE_BOOK}

You can also search the web (WebSearch) for what the book does not tell you: who a person or company is, a place, an event, where a quotation comes from, how a name is usually written in Korean. Search when a fact matters for the translation, and give the address of what you rely on.

You can also write: set_translation, set_glossary_term, add_comment, add_translator_note. The translator is asked before each write and may decline; a declined write is the translator's decision, not an error to work around. Write only what the translator asked for or agreed to; when unsure, propose in your reply instead.

How to work:
- Read before you answer. When asked about a paragraph, read it with a few paragraphs around it; a sentence's meaning often depends on what came before. When read returns \`next\`, call it again with exactly that to continue.
- Meaning first, then Korean. Get right what the author means — tone, irony, what is implied — before you work on the wording, and neither add nor drop meaning. Where the English can truly be read two ways, say so and say which reading the context supports, rather than choosing silently.
- Write Korean a reader would not know was translated. Rebuild a sentence when the English structure makes the Korean stiff: no needless pronouns (그는, 그것은), double passives or ~에 의해, ~를 가지다, overused ~들, idioms rendered word for word.
- The translation so far is the style guide. Match its register and sentence endings, how it writes names and numbers, and its punctuation. If you think one of its choices is wrong, say so; do not quietly write otherwise.
- Keep the book consistent. Where a term has an agreed Korean form in the glossary, use it; if you think it is wrong, say so rather than silently using another. When you settle the Korean for a name, a term or a recurring phrase, call search with its English first, and say where else it appears and how it was translated there, rather than guessing whether it comes up again. When it recurs and has no agreed form, suggest adding one.
- Recommend. Give first the rendering you would choose; add another only when it fits another reading, or a choice the translator might reasonably make differently.
- Explain why, from the word's context. Whenever you propose or judge a rendering, name the word or phrase that decides it — one or two, not every word: what it means here, what in the context settles that (the sentences around it, the author's argument, how the book uses it elsewhere), and why your Korean fits that sense better than the dictionary's first equivalent. Quote the English you rely on, and keep it short.
- Change as little as the problem needs. Edit the translator's sentence rather than replacing it; do not rewrite a paragraph to your taste.
- Mention what you notice. If, while reading, you see a clear error nearby, such as meaning wrong or missing or a glossary form not used, point it out in a line at the end. Leave matters of taste unless asked.
- Say what you are unsure of: a fact you could not confirm, a reading you are guessing at.
- Refer to paragraphs by id, like ¶123, so the translator can find them.
- Reply in the language the translator writes to you in (usually Korean). Quote the English when you discuss a phrase.
- Be concrete and brief.`

/** A task conversation's (tasks.mjs): the read tools only, one answer in the task's shape. What to look for is in
 *  the task's own prompt; nothing here speaks of the web or of writing, which a task does not have. */
export const TASK_SYSTEM_PROMPT = `You work inside fitz, the editor in which a professional translator is translating an English nonfiction book into Korean. You are the translator's colleague: you read the book through your tools and help with meaning, nuance, register and Korean wording.

${THE_BOOK}

Here you only read and report: you answer once, in the shape you are asked for, and the translator decides each suggestion.`

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
 *  PermissionResult. `task` (tasks.mjs) makes it a task conversation: read tools only, an answer of the task's shape,
 *  and limits. */
export function openSession({ db, resume, model, effort, ask, task, wrote, stop, cwd = AGENT_CWD }) {
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
      systemPrompt: task ? TASK_SYSTEM_PROMPT : SYSTEM_PROMPT,   // a string replaces Claude Code's coding prompt
      settingSources: [],                                        // the person's ~/.claude (CLAUDE.md, hooks, MCP servers) stays out
      // what settingSources does not reach (measured, 2.1.302): the person's claude.ai connectors (Gmail, Drive, …)
      // joined from the second request on, 28,000 tokens of tools; their skills were listed; auto memory was on
      strictMcpConfig: true,                                     // only the servers given here
      skills: [],
      settings: { disableClaudeAiConnectors: true, autoMemoryEnabled: false, disableBundledSkills: true },
      tools: task ? [] : WEB_TOOLS,                              // web search only, no Read/Edit/Bash/WebFetch: the PDF and page images cannot be opened
      mcpServers: { fitz: fitzServer(db, { write: !task, wrote }) },  // a task only finds: no write tools at all
      allowedTools: task ? READ_TOOLS : [...READ_TOOLS, ...WEB_TOOLS],  // reading and searching never ask
      permissionMode: "default",                                 // not bypass: every write is asked about
      canUseTool: async (toolName, input, options) =>            // writes go to the translator; nothing else is offered
        !task && WRITE_TOOLS.includes(toolName) ? ask(toolName, input, options) : { behavior: "deny", message: `${toolName} is not available in this conversation.` },
      // the checks of a turn's translations (docs/agent.md §19): an SDK callback, not a settings hook. Fail-open, measured:
      // a throw or a timeout ends the turn as passed — so the verdict the app keeps, not the hook, is the truth
      ...(stop && { hooks: { Stop: [{ hooks: [async (input, _id, { signal }) => stop(input, { signal })] }] } }),
      // a task answers in its shape (Claude Code adds a StructuredOutput tool for it, measured) and is bounded
      ...(task && { outputFormat: outputFormatOf(task), ...TASK_LIMITS }),
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
    /** What /model and /effort do (measured, docs/agent.md §8): from the next turn on; the effort set here outranks the
     *  one the session began with, and the settings it began with stay. */
    async configure({ model, effort }) {
      if (model) await q.setModel(model)
      if (effort) await q.applyFlagSettings({ effortLevel: effort })
    },
    // return(), not close(): the same cleanup, but it resolves once Claude Code has exited (measured in the SDK, 0.3.302:
    // it ends the input, waits up to 2 s, then sends SIGTERM). On its way out Claude Code still writes to the session
    // file (the title it gave the conversation), so whatever follows a close must wait for this.
    close() { input.close(); return q.return() },
  }
}
