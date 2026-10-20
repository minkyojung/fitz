// The server's conversations (docs/agent.md §6, §13). Each one is a Claude Code session (session.mjs) and the state
// fold.mjs makes of its messages, plus whoever follows it and the writes waiting for the translator's answer. Each is
// also kept in book.db (records.mjs): the list, and per turn what the session file lacks.
// Knows nothing of sockets: a follower is a function.
import { randomUUID } from "node:crypto"

import { getSessionInfo, getSessionMessages } from "@anthropic-ai/claude-agent-sdk"

import { listChapters } from "../commands.mjs"
import { applyMessage, emptyConversation, foldStored } from "./fold.mjs"
import { sessionKeeper } from "./keep.mjs"
import { addConversation, getConversation, listConversations, recordTurn, setConfig, setSession, setTitle, touchConversation, turnsOf } from "./records.mjs"
import { AGENT_CWD, openSession as openClaudeSession } from "./session.mjs"
import { DECISIONS } from "./protocol.mjs"
import { checkSegments, reasonFor } from "./checks.mjs"
import { saveSuggestions } from "./suggestions.mjs"
import { TASKS, TASK_NAMES } from "./tasks.mjs"
import { describeWrite } from "./tools.mjs"

export const DEFAULTS = { model: "claude-opus-5-5", effort: "medium" }
/** How many times a turn's translations are sent back to Claude before what is left wrong is the translator's. */
export const TRIES = 3

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

/** `openSession` is session.mjs's; `sessionInfo` and `sessionMessages` are the SDK's (the title Claude Code gives a
 *  session, and what it kept of one); `keep` copies session files against Claude Code's 30-day sweep and reads the cost
 *  they saved (keep.mjs).
 *  Tests pass stand-ins for all of them, so a test never touches the person's home folder. */
export function createAgentHost({
  db,
  openSession = openClaudeSession,
  sessionInfo = (id) => getSessionInfo(id, { dir: AGENT_CWD }),
  sessionMessages = (id) => getSessionMessages(id, { dir: AGENT_CWD }),
  keep = sessionKeeper({ cwd: AGENT_CWD }),
}) {
  const conversations = new Map()  // convId → { model, effort, task, session, keptSession, state, followers, asks, loaded, ready, turn }
  const conversation = (record) => ({
    model: record.model, effort: record.effort, task: record.task, session: null, keptSession: record.sessionId,
    state: { ...emptyConversation(), sessionId: record.sessionId }, followers: new Set(), asks: new Map(),
    loaded: true, ready: Promise.resolve(),
    turn: null,  // the turn going on: { wrote: paragraphs Claude translated, rounds: what each check found, rewrote, stopped, error, startedAt }
  })
  /** The conversation in memory, or brought back from book.db and Claude Code's session file (after a restart). While
   *  its history is being read it is not `loaded`; its followers get their snapshot when it is. */
  const get = (convId) => {
    if (conversations.has(convId)) return conversations.get(convId)
    const record = getConversation(db, convId) ?? fail(404, `no conversation ${convId}`)
    const conv = conversation(record)
    conversations.set(convId, conv)
    if (record.sessionId) {
      conv.loaded = false
      conv.ready = Promise.resolve()
        .then(() => { restore(record.sessionId); return sessionMessages(record.sessionId) })
        // what the next Claude Code counts its cost on from (docs/agent.md §24)
        .then((messages) => { conv.state = { ...foldStored(messages ?? [], turnsOf(db, record.sessionId), record.sessionId), spent: keep.savedCost(record.sessionId) } })
        .catch((e) => tell(conv, { type: "error", convId, message: `could not read the conversation back: ${e.message}` }))
        .then(() => { conv.loaded = true; tell(conv, snapshot(convId, conv)) })
    }
    return conv
  }
  const tell = (conv, event) => { for (const follower of conv.followers) follower(event) }
  /** At work: a turn going on, and the Claude Code it goes on in alive (docs/agent.md §23). Not the fold's status, which
   *  is idle until Claude Code's first message. */
  const working = (conv) => conv.turn !== null && conv.session !== null
  const snapshot = (convId, conv) => ({
    type: "snapshot", convId, state: conv.state, asks: pending(conv), model: conv.model, effort: conv.effort, working: working(conv),
    title: getConversation(db, convId)?.title ?? null, startedAt: working(conv) ? conv.turn.startedAt : null,
  })
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

  /** Claude would end its turn: check the translations it wrote in it (docs/agent.md §19). Something wrong goes back to
   *  Claude with what and where, the same turn going on, at most TRIES times; then what is left is the verdict. Sent
   *  back, Claude may say a form is right as it is and write nothing more: then it is not sent back again — what is
   *  left is the translator's to judge. A turn the translator stopped is not judged; a check that could not run says
   *  so rather than pass. */
  function checkTurn(conv, { signal }) {
    const t = conv.turn
    if (!t || !t.wrote.size || t.stopped || signal.aborted) return {}
    try {
      const failures = checkSegments(db, [...t.wrote])
      const declined = t.rounds.length > 0 && !t.rewrote
      t.rounds.push(failures)
      t.rewrote = false
      return failures.length && t.rounds.length <= TRIES && !declined ? { decision: "block", reason: reasonFor(failures) } : {}
    } catch (e) {
      t.error = `could not check: ${e.message}`
      console.error("agent:", t.error)
      return {}
    }
  }
  /** What a finished turn's checks found, as the turn record keeps it; null when there was nothing to judge. */
  const checksOf = (t) => (!t || t.stopped || !t.wrote.size ? null : {
    checked: [...t.wrote].sort((a, b) => a - b),
    rounds: t.rounds,
    ...((t.error || !t.rounds.length) && { error: t.error ?? "the turn ended before it could be checked" }),
  })

  /** Keep what the session file lacks. A record that fails is reported, never fatal to the conversation. */
  function keepRecords(convId, conv, message) {
    try {
      if (message.type === "system" && message.subtype === "init" && message.session_id !== conv.keptSession) {
        setSession(db, convId, message.session_id)
        conv.keptSession = message.session_id
      }
      if (message.type === "result") {
        const turn = conv.state.items.at(-1)
        const going = conv.turn
        conv.turn = null  // over, whether or not its record can be kept
        recordTurn(db, message.session_id, message.user_message_uuid ?? message.uuid, { ...turn, checks: checksOf(going) })
        try { keep.save(message.session_id) } catch (e) { console.error("agent: could not copy session", message.session_id, e.message) }
        if (!getConversation(db, convId)?.title) {
          void Promise.resolve(sessionInfo(message.session_id)).then((info) => {
            const title = info?.customTitle ?? info?.summary
            if (title) { setTitle(db, convId, title); tell(conv, { type: "titled", convId, title }) }
          }).catch((e) => console.error("agent: no title for", convId, e.message))
        }
      }
    } catch (e) {
      console.error("agent: could not keep conversation", convId, e.message)
    }
  }

  /** A task's answer, kept as suggestions for the translator. One that cannot be kept is told, never fatal. */
  function keepAnswer(convId, conv, message) {
    if (!conv.task || message.type !== "result" || message.structured_output === undefined) return
    try {
      const { skipped } = saveSuggestions(db, { conversationId: convId, task: conv.task, answer: message.structured_output })
      for (const { suggestion, why } of skipped) console.error(`agent: a ${conv.task} suggestion on ¶${suggestion.segmentId} was not kept: ${why}`)
    } catch (e) {
      tell(conv, { type: "error", convId, message: `Claude's suggestions could not be kept: ${e.message}` })
    }
  }

  /** The session file back in its place if Claude Code swept it, before it is read or resumed. */
  function restore(sessionId) {
    try { if (keep.restore(sessionId)) console.error("agent: restored the kept copy of session", sessionId) }
    catch (e) { console.error("agent: could not restore session", sessionId, e.message) }
  }

  // Claude Code starts with the first message, not with the conversation: an unused conversation costs no process.
  // A session that ends (the process died, or was closed) is opened again on the next message, going on with the
  // same session id.
  function ensureSession(convId, conv) {
    if (conv.session) return conv.session
    if (conv.state.sessionId) restore(conv.state.sessionId)
    const session = openSession({
      db, resume: conv.state.sessionId ?? undefined, model: conv.model, effort: conv.effort, task: conv.task,
      ask: (toolName, input, options) => ask(convId, conv, toolName, input, options),
      wrote: (segmentId) => { if (conv.turn) { conv.turn.wrote.add(segmentId); conv.turn.rewrote = true } },
      ...(!conv.task && { stop: (_input, options) => checkTurn(conv, options) }),
    })
    conv.session = session
    void (async () => {
      try {
        for await (const message of session.messages) {
          conv.state = applyMessage(conv.state, message)
          keepRecords(convId, conv, message)
          keepAnswer(convId, conv, message)                // before the result is told: whoever hears it can read them
          tell(conv, { type: "message", convId, message })
        }
      } catch (e) {
        tell(conv, { type: "error", convId, message: `Claude Code stopped: ${e.message}` })
      } finally {
        if (conv.session === session) {
          const cut = working(conv)
          conv.session = null
          for (const a of [...conv.asks.values()]) a.settle("cancelled")
          // a turn cut off with the process is over, even one Claude Code said nothing in; what was half written is
          // not kept. The next Claude Code counts its cost on from what this one saved, if it could (§24).
          const spent = conv.state.sessionId ? keep.savedCost(conv.state.sessionId) : conv.state.spent
          if (cut || conv.state.status !== "idle" || conv.state.live || spent !== conv.state.spent) {
            conv.state = { ...conv.state, status: "idle", live: null, spent }
            tell(conv, snapshot(convId, conv))
          }
        }
      }
    })()
    return session
  }

  /** The uuid the message's echo will carry. A conversation still being read back takes the message once it is
   *  (a promise then), and is resumed. */
  function send(convId, text) {
    const conv = get(convId)
    const go = () => {
      touchConversation(db, convId)
      conv.turn = { wrote: new Set(), rounds: [], rewrote: false, stopped: false, error: null, startedAt: Date.now() }
      // when it began, which every page counts the turn's time from (docs/agent.md §26)
      tell(conv, { type: "started", convId, startedAt: conv.turn.startedAt })
      return ensureSession(convId, conv).send(text)
    }
    return conv.loaded ? go() : conv.ready.then(go)
  }

  return {
    /** A task conversation (tasks.mjs) is given its chapter and sets to work at once, with the task's model unless
     *  another is asked for; a free one waits for the translator's first message. */
    start(convId, { task = null, chapterId = null, model = TASKS[task]?.model ?? DEFAULTS.model, effort = TASKS[task]?.effort ?? DEFAULTS.effort } = {}) {
      if (task !== null && !TASK_NAMES.includes(task)) fail(400, `no task ${task}`)
      if (conversations.has(convId) || getConversation(db, convId)) fail(409, `conversation ${convId} exists`)
      const chapter = task && (listChapters(db).find((c) => c.id === chapterId) ?? fail(404, `no chapter ${chapterId}`))
      addConversation(db, { id: convId, model, effort, task, chapterId: task && chapterId })
      conversations.set(convId, conversation({ model, effort, task, sessionId: null }))
      if (task) send(convId, TASKS[task].prompt(chapter))
    },
    /** The conversations, newest first, each saying whether it is at work: one known only from book.db is not. */
    list: () => listConversations(db).map((c) => ({ ...c, working: conversations.has(c.id) && working(conversations.get(c.id)) })),
    /** A snapshot (with the writes waiting for an answer) — now, or once a reopened conversation is read back — then
     *  every event. Returns the function that stops following. */
    open(convId, follower) {
      const conv = get(convId)
      if (conv.loaded) follower(snapshot(convId, conv))
      conv.followers.add(follower)
      return () => conv.followers.delete(follower)
    },
    send,
    answer(convId, requestId, decision) {
      if (!DECISIONS.includes(decision)) fail(400, `decision must be one of ${DECISIONS.join(", ")}`)
      const waiting = get(convId).asks.get(requestId) ?? fail(404, `nothing is waiting for answer ${requestId}`)
      waiting.settle(decision)
    },
    /** A free conversation's model and effort from its next message on (docs/agent.md §21): a running Claude Code is
     *  told, as /model and /effort tell it; the record too, so a resume after a restart opens with them; then whoever
     *  follows the conversation. Not while Claude answers. What Claude Code could not be told is not recorded. */
    async configure(convId, { model, effort }) {
      const conv = get(convId)
      await conv.ready
      if (conv.task) fail(400, "a task works with its own model")
      if (conv.turn && conv.session) fail(409, "Claude is answering: change the model or effort once it has finished")
      const next = { model: model ?? conv.model, effort: effort ?? conv.effort }
      const change = { ...(next.model !== conv.model && { model: next.model }), ...(next.effort !== conv.effort && { effort: next.effort }) }
      if (conv.session && (change.model || change.effort)) await conv.session.configure(change)
      setConfig(db, convId, next)
      Object.assign(conv, next)
      tell(conv, { type: "configured", convId, ...next })
    },
    stop(convId) {
      const conv = get(convId)
      if (conv.turn) conv.turn.stopped = true  // stopped by the translator: not judged
      void conv.session?.interrupt().catch(() => {})
    },
    /** Resolves once every Claude Code process has exited. */
    close() {
      return Promise.all([...conversations.values()].map((conv) => conv.session?.close()))
    },
  }
}
