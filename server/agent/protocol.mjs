// What the page and the server say to each other over the /live socket (docs/agent.md §7, §15). A closed set:
// a message of any other shape is refused. Everything from the page is checked here — it came over a socket.
//
// page → server
//   start { convId, model?, effort?, task?, chapterId? }  begin a conversation (convId: a uuid the page makes); with
//                                       a task (review | typos) and its chapter, a task conversation the app starts itself
//   configure { convId, model?, effort? }  a free conversation's model and effort from its next message (not mid-turn)
//   open  { convId }                    follow a conversation: a snapshot now, its messages from then on
//   send  { convId, text }              the translator's message
//   stop  { convId }                    stop the turn that is going
//   context { convId }                  how full the conversation is (docs/agent.md §32)
//   compact { convId }                  compact it (Claude Code's /compact)
//   answer { convId, requestId, decision }  allow | always (this tool, for the rest of the session) | deny
//   list                                the conversations, most recently used first
//   models                              the models Claude Code offers (docs/agent.md §31)
// server → page
//   snapshot { convId, state, asks, model, effort, working, title, startedAt }  the conversation as fold.mjs has it,
//                                       the writes waiting for an answer, the model and effort its next message goes to,
//                                       whether a turn is going on in a live Claude Code, its title (docs/agent.md §23),
//                                       and when the turn going on began (epoch ms, null when none; §26)
//   configured { convId, model, effort }  those changed
//   titled   { convId, title }          the title Claude Code gave it, kept once its first turn ends
//   context  { convId, usage }          { totalTokens, maxTokens, categories: [{ name, tokens, kind }] }, or null while no
//                                       Claude Code runs the conversation
//   started  { convId, startedAt }      a turn began (the translator's message, or a task's), before any of its messages
//   message  { convId, message }        one SDK message, to fold onto the snapshot
//   ask      { convId, ask }            a write waiting for the translator: { requestId, tool, input, preview }
//   asked    { convId, requestId, decision }  answered (or "cancelled": the turn stopped first)
//   conversations { items }            [{ id, sessionId, title, model, effort, task, chapterId, createdAt, usedAt, working }]
//   models   { items }                  [{ id, name, efforts }] in Claude Code's order; null before any Claude Code has said
//   changed  { opId, name, segmentIds, kind, actor }  the book changed (any writer; kind: do | undo | redo)
//   suggested { segmentIds }            Claude made new suggestions on these paragraphs (deciding one is a change)
//   session  { run? }                   Session's cards, answers or runs changed (docs/session.md): ask sessionToday again
//   error    { convId?, message }

import { TASK_NAMES } from "./tasks.mjs"

export const EFFORTS = ["low", "medium", "high", "xhigh", "max"]
export const DECISIONS = ["allow", "always", "deny"]
export const MAX_TEXT = 20000

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const MODEL = /^[a-z0-9][a-z0-9.-]{0,63}$/

const fail = (message) => { throw Object.assign(new Error(message), { status: 400 }) }
const convId = (v) => (typeof v === "string" && UUID.test(v) ? v : fail("convId must be a uuid"))

const modelAndEffort = (m) => ({
  ...(m.model !== undefined && { model: typeof m.model === "string" && MODEL.test(m.model) ? m.model : fail("model is not a model name") }),
  ...(m.effort !== undefined && { effort: EFFORTS.includes(m.effort) ? m.effort : fail(`effort must be one of ${EFFORTS.join(", ")}`) }),
})

/** A page message as the server will act on it: only the known fields, each checked. Throws on anything else. */
export function parseClientMessage(raw) {
  let m
  try { m = JSON.parse(raw) } catch { fail("not JSON") }
  if (!m || typeof m !== "object" || Array.isArray(m)) fail("not an object")
  switch (m.type) {
    case "start": {
      const out = { type: "start", convId: convId(m.convId), ...modelAndEffort(m) }
      if (m.task !== undefined) {
        out.task = TASK_NAMES.includes(m.task) ? m.task : fail(`task must be one of ${TASK_NAMES.join(", ")}`)
        out.chapterId = Number.isInteger(m.chapterId) ? m.chapterId : fail("a task needs the chapterId it works on")
      }
      return out
    }
    case "configure": {
      const out = { type: "configure", convId: convId(m.convId), ...modelAndEffort(m) }
      if (!out.model && !out.effort) fail("configure needs a model or an effort")
      return out
    }
    case "answer": {
      const requestId = typeof m.requestId === "string" && UUID.test(m.requestId) ? m.requestId : fail("requestId must be a uuid")
      if (!DECISIONS.includes(m.decision)) fail(`decision must be one of ${DECISIONS.join(", ")}`)
      return { type: "answer", convId: convId(m.convId), requestId, decision: m.decision }
    }
    case "list":
      return { type: "list" }
    case "models":
      return { type: "models" }
    case "open":
    case "context":
    case "compact":
    case "stop":
      return { type: m.type, convId: convId(m.convId) }
    case "send": {
      if (typeof m.text !== "string" || !m.text.trim()) fail("text must be a non-empty string")
      if (m.text.length > MAX_TEXT) fail(`text is longer than ${MAX_TEXT} characters`)
      return { type: "send", convId: convId(m.convId), text: m.text }
    }
    default:
      fail(`unknown message type ${JSON.stringify(m.type)}`)
  }
}
