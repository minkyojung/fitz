// The only place that starts Claude Code (docs/agent.md §1–2). It decides how a session starts and nothing
// about what its messages mean — fold.mjs does that. Every option is set here on purpose: the SDK's defaults
// are the terminal's, and several are wrong for an editor.
import { randomUUID } from "node:crypto"
import { mkdirSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

import { query, startup } from "@anthropic-ai/claude-agent-sdk"

import { TASK_LIMITS, outputFormatOf } from "./tasks.mjs"
import { READ_TOOL_NAMES, WRITE_TOOL_NAMES, fitzServer } from "./tools.mjs"
import { createWarmer } from "./warm.mjs"

/** A new free conversation's model and effort unless another is asked for; what the one started ahead has (§30). */
export const DEFAULTS = { model: "claude-opus-5-5", effort: "medium" }

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

You can also write: set_translation, edit_translation, set_glossary_term, add_comment, reply_comment, resolve_comment, add_translator_note, set_note. The translator is asked before each write and may decline; a declined write is the translator's decision, not an error to work around. Write only what the translator asked for or agreed to; when unsure, propose in your reply instead.

How to work:
- Read before you answer. When asked about a paragraph, read it with a few paragraphs around it; a sentence's meaning often depends on what came before. When read returns \`next\`, call it again with exactly that to continue.
- Meaning first, then Korean. Get right what the author means — tone, irony, what is implied — before you work on the wording, and neither add nor drop meaning. Where the English can truly be read two ways, say so and say which reading the context supports, rather than choosing silently.
- Write Korean a reader would not know was translated. Rebuild a sentence when the English structure makes the Korean stiff: no needless pronouns (그는, 그것은), double passives or ~에 의해, ~를 가지다, overused ~들, idioms rendered word for word.
- The translation so far is the style guide. Match its register and sentence endings, how it writes names and numbers, and its punctuation. If you think one of its choices is wrong, say so; do not quietly write otherwise.
- Keep the book consistent. Where a term has an agreed Korean form in the glossary, use it; if you think it is wrong, say so rather than silently using another. When you settle the Korean for a name, a term or a recurring phrase, call search with its English first, and say where else it appears and how it was translated there, rather than guessing whether it comes up again. When it recurs and has no agreed form, suggest adding one.
- Recommend. Give first the rendering you would choose; add another only when it fits another reading, or a choice the translator might reasonably make differently.
- Explain why, from the word's context. Whenever you propose or judge a rendering, name the word or phrase that decides it — one or two, not every word: what it means here, what in the context settles that (the sentences around it, the author's argument, how the book uses it elsewhere), and why your Korean fits that sense better than the dictionary's first equivalent. Quote the English you rely on, and keep it short.
- Change as little as the problem needs. Edit the translator's sentence rather than replacing it (edit_translation changes only the words you quote); do not rewrite a paragraph to your taste.
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

/** Prompts for one conversation, fed to query() as streaming input: the session stays open between turns. Nothing
 *  goes out before `until` settles (a model to switch on the one started ahead, §30). */
function inbox(until = Promise.resolve()) {
  const queue = []
  let wake = null
  let closed = false
  return {
    push(msg) { queue.push(msg); wake?.(); wake = null },
    close() { closed = true; wake?.(); wake = null },
    async *[Symbol.asyncIterator]() {
      await until
      for (;;) {
        if (queue.length) { yield queue.shift(); continue }
        if (closed) return
        await new Promise((resolve) => { wake = resolve })
      }
    },
  }
}

/** The options one query() takes. `slot` holds the conversation's callbacks — `ask`, `wrote`, `stop` — bound later for
 *  a process started ahead (§30), so the options can be made before the conversation exists. */
function sessionOptions({ db, resume, model, effort, task, cwd, slot }) {
  return {
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
      mcpServers: { fitz: fitzServer(db, { write: !task, wrote: (segmentId) => slot.wrote?.(segmentId) }) },  // a task only finds: no write tools at all
      allowedTools: task ? READ_TOOLS : [...READ_TOOLS, ...WEB_TOOLS],  // reading and searching never ask
      permissionMode: "default",                                 // not bypass: every write is asked about
      canUseTool: async (toolName, input, options) =>            // writes go to the translator; nothing else is offered
        !task && WRITE_TOOLS.includes(toolName) && slot.ask ? slot.ask(toolName, input, options) : { behavior: "deny", message: `${toolName} is not available in this conversation.` },
      // the checks of a turn's translations (docs/agent.md §19): an SDK callback, not a settings hook. Fail-open, measured:
      // a throw or a timeout ends the turn as passed — so the verdict the app keeps, not the hook, is the truth
      ...(!task && { hooks: { Stop: [{ hooks: [async (input, _id, { signal }) => (slot.stop ? slot.stop(input, { signal }) : {})] }] } }),
      // a task answers in its shape (Claude Code adds a StructuredOutput tool for it, measured) and is bounded
      ...(task && { outputFormat: outputFormatOf(task), ...TASK_LIMITS }),
      includePartialMessages: true,                              // text as it is written
      extraArgs: { "replay-user-messages": null },               // the echo of what was sent, with its uuid (measured: off by default)
      env: { ...ownEnv(process.env), CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS: "1" },  // env replaces the whole environment; idle/running state
      stderr: (data) => process.stderr.write(`[claude] ${data}`),
  }
}

/** An input that waits for the conversation's inbox to be attached, then passes it through: what a Claude Code
 *  started ahead reads until a conversation takes it (§31). Ended, it yields nothing more. */
function relay() {
  let attach
  const attached = new Promise((resolve) => { attach = resolve })
  return {
    attach,
    end: () => attach(null),
    async *[Symbol.asyncIterator]() { const source = await attached; if (source) yield* source },
  }
}

// --- the models Claude Code offers (docs/agent.md §31): asked of any Query once, kept for the server's life

let models = null
/** What the page is offered: the current family by alias (opus, sonnet, …), not `default` and not the older models
 *  named in full; each with the id Claude Code resolves it to and the efforts it takes. */
export const offeredModels = (list) =>
  (list ?? []).filter((m) => !m.value.startsWith("claude-") && m.value !== "default")
    .map((m) => ({ id: m.resolvedModel ?? m.value, name: m.displayName, efforts: m.supportsEffort ? m.supportedEffortLevels ?? [] : [] }))
/** The models known so far, or null before any Claude Code has said. */
export const knownModels = () => models
async function noteModels(q) {
  if (models) return
  try { const list = await q.supportedModels(); if (list?.length) models = offeredModels(list) } catch { /* an old CLI, or a process gone: the next one */ }
}

// --- one Claude Code started ahead, for the next new free conversation (docs/agent.md §30)

let warmer = null
let warmth = { taken: 0, cold: 0 }
/** Start one ahead, and another each time one is taken, until `closeWarming`. For the book `db` in `cwd`. */
export function startWarming(db, { cwd = AGENT_CWD, start = startup } = {}) {
  closeWarming()
  mkdirSync(cwd, { recursive: true })
  warmth = { taken: 0, cold: 0 }
  const slot = {}
  // started, given a relay as its input, and made a Query at once: it can be asked things (the models, §31) while
  // it waits, and the conversation that takes it attaches its own inbox
  const prepare = async ({ options }) => {
    const warm = await start({ options })
    const input = relay()
    const q = warm.query(input)
    void noteModels(q)
    return { q, input, close() { input.end(); void Promise.resolve(q.return?.()).catch(() => {}) } }
  }
  const w = createWarmer({ startup: prepare, options: () => sessionOptions({ db, model: DEFAULTS.model, effort: DEFAULTS.effort, task: null, cwd, slot }) })
  warmer = { take: w.take, close: w.close, db, cwd, slot }
  return warmer
}
export function closeWarming() { warmer?.close(); warmer = null }
/** How many new conversations took the one started ahead, and how many started cold (for the real test). */
export const warmthSoFar = () => ({ ...warmth })

/** One conversation = one query(). `messages` is the SDK's stream; `send` returns the uuid the echo will carry.
 *  `ask(toolName, input, { signal })` is the host's: it puts a write to the translator and resolves with Claude Code's
 *  PermissionResult. `task` (tasks.mjs) makes it a task conversation: read tools only, an answer of the task's shape,
 *  and limits. A new free conversation takes the Claude Code started ahead when there is one (§30), switched to its
 *  model and effort first if they are not the defaults; otherwise, and for a resumed or a task conversation, one is
 *  started now. */
export function openSession({ db, resume, model, effort, ask, task, wrote, stop, cwd = AGENT_CWD, sdk = { query } }) {
  mkdirSync(cwd, { recursive: true })
  const slot = { ask, wrote, stop }
  const warmable = !resume && !task && warmer && warmer.db === db && warmer.cwd === cwd
  // nothing is sent before the query is settled and switched: the inbox waits for `ready`, made just below
  let settled
  const input = inbox(new Promise((resolve) => { settled = resolve }))
  // the query: the one ahead, or one started now
  const ready = (async () => {
    const spare = warmable ? await warmer.take() : null
    if (spare) {
      try {
        Object.assign(warmer.slot, slot)  // the process ahead was made with the warmer's slot: now this conversation's
        if (model !== DEFAULTS.model) await spare.q.setModel(model)
        if (effort !== DEFAULTS.effort) await spare.q.applyFlagSettings({ effortLevel: effort })
        spare.input.attach(input)  // from here on it reads this conversation's messages
        warmth.taken++
        return spare.q
      } catch (e) {
        console.error("agent: the Claude Code started ahead could not be used, starting one:", e.message)
      }
    }
    warmth.cold++
    const q = sdk.query({ prompt: input, options: sessionOptions({ db, resume, model, effort, task, cwd, slot }) })
    void noteModels(q)
    return q
  })()
  ready.then(settled, settled)
  return {
    messages: (async function* () { yield* await ready })(),
    send(text) {
      const uuid = randomUUID()
      input.push({ type: "user", message: { role: "user", content: text }, parent_tool_use_id: null, uuid })
      return uuid
    },
    /** Stop the turn; with cancelQueued, what waits behind it too (§33; the receipt names what was cancelled). */
    interrupt: async (options) => (await ready).interrupt(options),
    /** How full the conversation is (docs/agent.md §32): Claude Code's count by category (0.3 s once, then cached;
     *  no cost, measured). */
    async context() {
      const u = await (await ready).getContextUsage({ detail: "full" })
      return { totalTokens: u.totalTokens, maxTokens: u.maxTokens, categories: (u.categories ?? []).map((c) => ({ name: c.name, tokens: c.tokens, kind: c.kind })) }
    },
    /** What /model and /effort do (measured, docs/agent.md §8): from the next turn on; the effort set here outranks the
     *  one the session began with, and the settings it began with stay. */
    async configure({ model, effort }) {
      const q = await ready
      if (model) await q.setModel(model)
      if (effort) await q.applyFlagSettings({ effortLevel: effort })
    },
    // return(), not close(): the same cleanup, but it resolves once Claude Code has exited (measured in the SDK, 0.3.302:
    // it ends the input, waits up to 2 s, then sends SIGTERM). On its way out Claude Code still writes to the session
    // file (the title it gave the conversation), so whatever follows a close must wait for this.
    async close() { input.close(); return (await ready).return() },
  }
}
