// The server's conversations (docs/agent.md §6). Each one is a Claude Code session (session.mjs) and the state
// fold.mjs makes of its messages, plus whoever follows it and the writes waiting for the translator's answer.
// Knows nothing of sockets: a follower is a function.
import { randomUUID } from "node:crypto"

import { applyMessage, emptyConversation } from "./fold.mjs"
import { openSession as openClaudeSession } from "./session.mjs"
import { DECISIONS } from "./protocol.mjs"
import { describeWrite } from "./tools.mjs"

export const DEFAULTS = { model: "claude-opus-5-5", effort: "medium" }

const FITZ = "mcp__fitz__"
const fail = (status, message) => { throw Object.assign(new Error(message), { status }) }

/** Claude Code's answer for each decision. "always" allows this tool for the rest of the session — a session rule,
 *  not the settings-file rule Claude Code suggests, which would outlive the conversation. */
const permission = (decision, toolName, input) => {
  if (decision === "allow") return { behavior: "allow", updatedInput: input }
  if (decision === "always") return { behavior: "allow", updatedInput: input, updatedPermissions: [{ type: "addRules", rules: [{ toolName }], behavior: "allow", destination: "session" }] }
  if (decision === "deny") return { behavior: "deny", message: "The translator declined this. Do not try it another way; ask or carry on without it." }
  return { behavior: "deny", message: "The turn was stopped before the translator answered." }
}

/** `openSession` is session.mjs's, or a stand-in in tests. */
export function createAgentHost({ db, openSession = openClaudeSession }) {
  const conversations = new Map()  // convId → { model, effort, session, state, followers, asks }
  const get = (convId) => conversations.get(convId) ?? fail(404, `no conversation ${convId}`)
  const tell = (conv, event) => { for (const follower of conv.followers) follower(event) }
  const pending = (conv) => [...conv.asks.values()].map((a) => a.ask)

  /** A write put to the translator. Resolves when they answer, or when the turn stops (signal). */
  function ask(convId, conv, toolName, input, { signal } = {}) {
    const tool = toolName.slice(FITZ.length)
    let preview
    try { preview = describeWrite(db, tool, input) } catch (e) { return { behavior: "deny", message: e.message } }
    const requestId = randomUUID()
    return new Promise((resolve) => {
      const settle = (decision) => {
        if (!conv.asks.delete(requestId)) return
        tell(conv, { type: "asked", convId, requestId, decision })
        resolve(permission(decision, toolName, input))
      }
      conv.asks.set(requestId, { ask: { requestId, tool, input, preview }, settle })
      signal?.addEventListener("abort", () => settle("cancelled"), { once: true })
      tell(conv, { type: "ask", convId, ask: conv.asks.get(requestId).ask })
    })
  }

  // Claude Code starts with the first message, not with the conversation: an unused conversation costs no process.
  // A session that ends (the process died, or was closed) is opened again on the next message, going on with the
  // same session id.
  function ensureSession(convId, conv) {
    if (conv.session) return conv.session
    const session = openSession({
      db, resume: conv.state.sessionId ?? undefined, model: conv.model, effort: conv.effort,
      ask: (toolName, input, options) => ask(convId, conv, toolName, input, options),
    })
    conv.session = session
    void (async () => {
      try {
        for await (const message of session.messages) {
          conv.state = applyMessage(conv.state, message)
          tell(conv, { type: "message", convId, message })
        }
      } catch (e) {
        tell(conv, { type: "error", convId, message: `Claude Code stopped: ${e.message}` })
      } finally {
        if (conv.session === session) {
          conv.session = null
          for (const a of [...conv.asks.values()]) a.settle("cancelled")
          // a turn cut off with the process is over; what was half written is not kept
          if (conv.state.status !== "idle" || conv.state.live) {
            conv.state = { ...conv.state, status: "idle", live: null }
            tell(conv, { type: "snapshot", convId, state: conv.state, asks: pending(conv) })
          }
        }
      }
    })()
    return session
  }

  return {
    start(convId, { model = DEFAULTS.model, effort = DEFAULTS.effort } = {}) {
      if (conversations.has(convId)) fail(409, `conversation ${convId} exists`)
      conversations.set(convId, { model, effort, session: null, state: emptyConversation(), followers: new Set(), asks: new Map() })
    },
    /** A snapshot now (with the writes waiting for an answer), then every event. Returns the function that stops following. */
    open(convId, follower) {
      const conv = get(convId)
      follower({ type: "snapshot", convId, state: conv.state, asks: pending(conv) })
      conv.followers.add(follower)
      return () => conv.followers.delete(follower)
    },
    send(convId, text) {
      const conv = get(convId)
      return ensureSession(convId, conv).send(text)
    },
    answer(convId, requestId, decision) {
      if (!DECISIONS.includes(decision)) fail(400, `decision must be one of ${DECISIONS.join(", ")}`)
      const waiting = get(convId).asks.get(requestId) ?? fail(404, `nothing is waiting for answer ${requestId}`)
      waiting.settle(decision)
    },
    stop(convId) {
      void get(convId).session?.interrupt().catch(() => {})
    },
    close() {
      for (const conv of conversations.values()) conv.session?.close()
    },
  }
}
