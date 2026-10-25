// What a conversation is, folded from Claude Agent SDK messages (docs/agent.md §6). Pure: (state, message) →
// new state, never mutating. The server folds every message as it arrives; the page folds the same messages
// from a snapshot on, so a window opened mid-turn ends where the server is. Unknown messages are ignored:
// the SDK's set grows over time.

/** items: what the conversation shows, in order —
 *    { kind: "user", uuid, text }                     a message the translator sent (its echo)
 *    { kind: "thinking", id, text }                   Claude's summarised thinking
 *    { kind: "text", id, text }                       Claude's words
 *    { kind: "tool", id, name, input, status, result } a tool call; status "running" | "done" | "error"
 *    { kind: "turn", reason, isError, ms, cost, error } a turn's end; error: what the API answered when it did not
 *                                                     answer (authentication_failed, rate_limit, overloaded, …), else null
 *    { kind: "compact", pre, post }                   the conversation was compacted here: tokens before and after
 *  live: the block being written now, { kind: "thinking" | "text" | "tool", text, name? }, or null.
 *  status: "idle" | "running" | "requires_action", as Claude Code reports it.
 *  retry: a request being tried again { attempt, max, delayMs, error }, or null (docs/agent.md §29).
 *  limits: the plan's last rate_limit_event { status, type, resetsAt (ms), windows }, or null.
 *  compacting: Claude Code is compacting the conversation (docs/agent.md §32). */
export const emptyConversation = () => ({ sessionId: null, model: null, status: "idle", items: [], live: null, spent: 0, retry: null, limits: null, apiError: null, compacting: false })

const FITZ = "mcp__fitz__"
const toolName = (name) => (name.startsWith(FITZ) ? name.slice(FITZ.length) : name)
const textOf = (content) =>
  typeof content === "string" ? content : (content ?? []).filter((b) => b.type === "text").map((b) => b.text).join("")
/** What Claude Code puts in a user message that is not the translator's words: a local command (/compact) and its
 *  output, the summary a compaction leaves (measured, docs/agent.md §32). */
const COMMAND = /^\s*<(command-name|local-command-stdout|local-command-stderr)>/
const notTheirs = (m) => m.isSynthetic || m.isCompactSummary || m.isMeta || m.is_meta || COMMAND.test(textOf(m.message?.content))

export function applyMessage(state, m) {
  switch (m.type) {
    case "system":
      if (m.subtype === "init") return { ...state, sessionId: m.session_id, model: m.model }
      if (m.subtype === "session_state_changed") return { ...state, status: m.state }
      if (m.subtype === "api_retry") return { ...state, retry: { attempt: m.attempt, max: m.max_retries, delayMs: m.retry_delay_ms, error: m.error ?? null } }
      if (m.subtype === "status") return m.status === "compacting" ? { ...state, compacting: true } : state.compacting ? { ...state, compacting: false } : state
      if (m.subtype === "compact_boundary") {
        const c = m.compact_metadata ?? m
        return { ...state, compacting: false, items: [...state.items, { kind: "compact", pre: c.pre_tokens ?? null, post: c.post_tokens ?? null }] }
      }
      return state

    case "rate_limit_event": {
      const r = m.rate_limit_info
      if (!r || typeof r !== "object") return state
      return { ...state, limits: { status: r.status ?? null, type: r.rateLimitType ?? null, resetsAt: typeof r.resetsAt === "number" ? r.resetsAt * 1000 : null, windows: r.unifiedWindows ?? null } }
    }

    case "stream_event": {
      if (m.parent_tool_use_id) return state
      const e = m.event
      if (state.retry) state = { ...state, retry: null }  // anything streaming: the request went through
      if (e.type === "content_block_start") {
        const b = e.content_block
        if (b.type === "text" || b.type === "thinking") return { ...state, live: { kind: b.type, text: "" } }
        if (b.type === "tool_use") return { ...state, live: { kind: "tool", name: toolName(b.name), text: "" } }
        return state
      }
      if (e.type === "content_block_delta" && state.live) {
        const d = e.delta
        const piece = d.type === "text_delta" ? d.text : d.type === "thinking_delta" ? d.thinking : d.type === "input_json_delta" ? d.partial_json : ""
        return piece ? { ...state, live: { ...state.live, text: state.live.text + piece } } : state
      }
      if (e.type === "message_stop") return state.live ? { ...state, live: null } : state
      return state
    }

    case "assistant": {
      // one finished content block per message; it replaces the block that was streaming
      if (m.parent_tool_use_id) return state
      const added = m.message.content.flatMap((b, i) => {
        const id = `${m.message.id}:${m.uuid ?? i}`
        if (b.type === "text") return [{ kind: "text", id, text: b.text }]
        if (b.type === "thinking") return b.thinking ? [{ kind: "thinking", id, text: b.thinking }] : []
        if (b.type === "tool_use") return [{ kind: "tool", id: b.id, name: toolName(b.name), input: b.input, status: "running", result: null }]
        return []
      })
      // one the API refused instead of answering says why (measured: no login → error "authentication_failed")
      return { ...state, items: [...state.items, ...added], live: null, retry: null, apiError: m.error ?? state.apiError }
    }

    case "user": {
      if (m.parent_tool_use_id) return state
      const results = Array.isArray(m.message.content) ? m.message.content.filter((b) => b.type === "tool_result") : []
      if (results.length) {
        // structured result on the stream (tool_use_result); a failed, refused or stopped call's is a string
        const structured = m.tool_use_result && typeof m.tool_use_result === "object" ? m.tool_use_result.structuredContent : undefined
        const items = state.items.map((it) => {
          const r = it.kind === "tool" && results.find((x) => x.tool_use_id === it.id)
          if (!r) return it
          return { ...it, status: r.is_error ? "error" : "done", result: !r.is_error && results.length === 1 && structured !== undefined ? structured : textOf(r.content) }
        })
        return { ...state, items }
      }
      // only the echo of what was sent is the translator's; other user messages (interruptions, synthetic, a local
      // command and its output) are not
      if (!m.isReplay || notTheirs(m)) return state
      return { ...state, items: [...state.items, { kind: "user", uuid: m.uuid, text: textOf(m.message.content) }] }
    }

    case "result": {
      // total_cost_usd is the process's running total: a turn's cost is what it added
      const total = m.total_cost_usd ?? state.spent
      // a local command's (/compact) is not a turn: what it cost is counted, nothing is shown for it
      if (m.local_command) return { ...state, live: null, spent: total, status: "idle", retry: null, apiError: null, compacting: false }
      const turn = { kind: "turn", reason: m.terminal_reason ?? m.subtype, isError: m.is_error === true, ms: m.duration_ms, cost: total - state.spent, error: state.apiError }
      return { ...state, items: [...state.items, turn], live: null, spent: total, status: "idle", retry: null, apiError: null }
    }

    default:
      return state
  }
}

export const foldMessages = (messages, state = emptyConversation()) => messages.reduce(applyMessage, state)

// --- a conversation read back from disk

/** What Claude Code writes into a session as the user's when a turn is interrupted; not the translator's words. */
const INTERRUPTED = /^\[Request interrupted by user( for tool use)?\]$/
const isToolResult = (m) => Array.isArray(m.message.content) && m.message.content.some((b) => b.type === "tool_result")
/** fitz tools answer in JSON (their structuredContent); the session file keeps only the text, so read it back. */
const structured = (m) => {
  const results = m.message.content.filter((b) => b.type === "tool_result")
  if (results.length !== 1 || results[0].is_error) return undefined
  try { return { structuredContent: JSON.parse(textOf(results[0].content)) } } catch { return undefined }
}

/** A conversation as getSessionMessages gives it, with the turns the app kept (user message uuid → turn), folded into
 *  the same state the live fold makes (docs/agent.md §13). The session file has no stream fragments and no result:
 *  each prompt is the translator's message, and a kept turn closes before the next prompt. */
export function foldStored(messages, turns = new Map(), sessionId = null) {
  let state = { ...emptyConversation(), sessionId }
  let prompt = null
  const close = () => {
    const t = prompt && turns.get(prompt)
    if (t) state = { ...state, items: [...state.items, { kind: "turn", reason: t.reason, isError: t.isError, ms: t.ms, cost: t.cost, error: null }] }
    prompt = null
  }
  for (const m of messages) {
    if (m.parent_tool_use_id) continue
    if (m.type === "assistant") state = applyMessage(state, m)
    else if (m.type === "system" && m.subtype === "compact_boundary") { close(); state = applyMessage(state, m) }
    else if (m.type === "user" && isToolResult(m)) state = applyMessage(state, { ...m, tool_use_result: structured(m) })
    else if (m.type === "user" && !INTERRUPTED.test(textOf(m.message.content).trim()) && !notTheirs(m)) {
      close()
      prompt = m.uuid
      state = applyMessage(state, { ...m, isReplay: true })
    }
  }
  close()
  return state
}

