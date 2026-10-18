// The server's conversations (docs/agent.md §6). Each one is a Claude Code session (session.mjs) and the state
// fold.mjs makes of its messages, plus whoever follows it. Knows nothing of sockets: a follower is a function.
import { applyMessage, emptyConversation } from "./fold.mjs"
import { openSession as openClaudeSession } from "./session.mjs"

export const DEFAULTS = { model: "claude-opus-5-5", effort: "medium" }

const fail = (status, message) => { throw Object.assign(new Error(message), { status }) }

/** `openSession` is session.mjs's, or a stand-in in tests. */
export function createAgentHost({ db, openSession = openClaudeSession }) {
  const conversations = new Map()  // convId → { model, effort, session, state, followers }
  const get = (convId) => conversations.get(convId) ?? fail(404, `no conversation ${convId}`)
  const tell = (conv, event) => { for (const follower of conv.followers) follower(event) }

  // Claude Code starts with the first message, not with the conversation: an unused conversation costs no process.
  // A session that ends (the process died, or was closed) is opened again on the next message, going on with the
  // same session id.
  function ensureSession(convId, conv) {
    if (conv.session) return conv.session
    const session = openSession({ db, resume: conv.state.sessionId ?? undefined, model: conv.model, effort: conv.effort })
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
          // a turn cut off with the process is over; what was half written is not kept
          if (conv.state.status !== "idle" || conv.state.live) {
            conv.state = { ...conv.state, status: "idle", live: null }
            tell(conv, { type: "snapshot", convId, state: conv.state })
          }
        }
      }
    })()
    return session
  }

  return {
    start(convId, { model = DEFAULTS.model, effort = DEFAULTS.effort } = {}) {
      if (conversations.has(convId)) fail(409, `conversation ${convId} exists`)
      conversations.set(convId, { model, effort, session: null, state: emptyConversation(), followers: new Set() })
    },
    /** A snapshot now, then every message. Returns the function that stops following. */
    open(convId, follower) {
      const conv = get(convId)
      follower({ type: "snapshot", convId, state: conv.state })
      conv.followers.add(follower)
      return () => conv.followers.delete(follower)
    },
    send(convId, text) {
      const conv = get(convId)
      return ensureSession(convId, conv).send(text)
    },
    stop(convId) {
      void get(convId).session?.interrupt().catch(() => {})
    },
    close() {
      for (const conv of conversations.values()) conv.session?.close()
    },
  }
}
