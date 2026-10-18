// What a conversation is, folded from Claude Agent SDK messages (docs/agent.md §6). Pure: (state, message) →
// new state, never mutating. The server folds every message as it arrives; the page folds the same messages
// from a snapshot on, so a window opened mid-turn ends where the server is. Unknown messages are ignored:
// the SDK's set grows over time.

/** items: what the conversation shows, in order —
 *    { kind: "user", uuid, text }                     a message the translator sent (its echo)
 *    { kind: "thinking", id, text }                   Claude's summarised thinking
 *    { kind: "text", id, text }                       Claude's words
 *    { kind: "tool", id, name, input, status, result } a tool call; status "running" | "done" | "error"
 *    { kind: "turn", reason, isError, ms, cost }       a turn's end
 *  live: the block being written now, { kind: "thinking" | "text" | "tool", text, name? }, or null.
 *  status: "idle" | "running" | "requires_action", as Claude Code reports it. */
export const emptyConversation = () => ({ sessionId: null, model: null, status: "idle", items: [], live: null, spent: 0 })

const FITZ = "mcp__fitz__"
const toolName = (name) => (name.startsWith(FITZ) ? name.slice(FITZ.length) : name)
const textOf = (content) =>
  typeof content === "string" ? content : (content ?? []).filter((b) => b.type === "text").map((b) => b.text).join("")

export function applyMessage(state, m) {
  switch (m.type) {
    case "system":
      if (m.subtype === "init") return { ...state, sessionId: m.session_id, model: m.model }
      if (m.subtype === "session_state_changed") return { ...state, status: m.state }
      return state

    case "stream_event": {
      if (m.parent_tool_use_id) return state
      const e = m.event
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
      return { ...state, items: [...state.items, ...added], live: null }
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
      // only the echo of what was sent is the translator's; other user messages (interruptions, synthetic) are not
      if (!m.isReplay) return state
      return { ...state, items: [...state.items, { kind: "user", uuid: m.uuid, text: textOf(m.message.content) }] }
    }

    case "result": {
      // total_cost_usd is the process's running total: a turn's cost is what it added
      const total = m.total_cost_usd ?? state.spent
      const turn = { kind: "turn", reason: m.terminal_reason ?? m.subtype, isError: m.is_error === true, ms: m.duration_ms, cost: total - state.spent }
      return { ...state, items: [...state.items, turn], live: null, spent: total, status: "idle" }
    }

    default:
      return state
  }
}

export const foldMessages = (messages, state = emptyConversation()) => messages.reduce(applyMessage, state)
