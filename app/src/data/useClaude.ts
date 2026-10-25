import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { api } from "./http"
import type { AskDecision, ConversationSummary, ModelOffer, TurnChecks } from "./api"
import { applyEvent, emptyView, withPointed, type ConversationView, type Pointed } from "@/lib/conversation"
import { WRITE_TOOLS } from "@/lib/trace"

/** The models and efforts offered until the server says what Claude Code offers (docs/agent.md §31); the server's
 *  default first. */
export const MODELS: ModelOffer[] = [
  { id: "claude-opus-5-5", name: "Opus 5.5", efforts: ["low", "medium", "high"] },
  { id: "claude-sonnet-5-5", name: "Sonnet 5.5", efforts: ["low", "medium", "high"] },
  { id: "claude-haiku-5-5", name: "Haiku 5.5", efforts: ["low", "medium", "high"] },
]

/** The conversation with Claude the Claude tab shows (docs/agent.md §17). It opens on an empty new conversation, which
 *  begins with its first message; past ones come from the list. What the translator pointed at (Ask Claude) waits
 *  here until it is sent with their words. The model and effort can change between turns (§21). */
export function useClaude() {
  const [convId, setConvId] = useState<string | null>(null)
  const [view, setView] = useState<ConversationView>(emptyView)
  const [list, setList] = useState<ConversationSummary[]>([])
  // what Claude Code offers, asked of the server when the page opens and after a reconnect; the page's own list until it says
  const [models, setModels] = useState<ModelOffer[]>(MODELS)
  useEffect(() => {
    const ask = () => api.listModels().then((offered) => { if (offered?.length) setModels(offered) }).catch(() => undefined)
    void ask()
    return api.watchChanges((c) => { if (c.kind === "resync") void ask() })
  }, [])
  const [choice, setChoice] = useState<{ model: string; effort: string }>({ model: MODELS[0].id, effort: "medium" })
  const [pointed, setPointed] = useState<Pointed | null>(null)
  // a message sent and not yet echoed back by Claude Code: the first one waits for its process to start
  const [pending, setPending] = useState<string | null>(null)
  // when the translator last sent one: the live line counts from it until the server says when the turn began
  const [sentAt, setSentAt] = useState<number | null>(null)
  const unfollow = useRef<(() => void) | null>(null)
  useEffect(() => () => unfollow.current?.(), [])

  const users = view.state.items.filter((i) => i.kind === "user").length
  const echoed = useRef(users)
  useEffect(() => {
    if (users > echoed.current || view.error) setPending(null)
    echoed.current = users
  }, [users, view.error])

  const follow = useCallback((id: string, start?: { model: string; effort: string }) => {
    unfollow.current?.()
    setConvId(id)
    setPending(null)
    // a new conversation has nothing to wait for; one from the list shows once its snapshot comes
    setView(start ? { ...emptyView(), loaded: true } : emptyView())
    echoed.current = 0
    unfollow.current = api.followConversation(id, (e) => setView((v) => applyEvent(v, e)), start)
  }, [])

  const refreshList = useCallback(
    () => api.listConversations().then((items) => setList(items.filter((c) => c.task === null))).catch(() => undefined),
    [],
  )

  const send = useCallback((text: string) => {
    let id = convId
    if (!id) { id = crypto.randomUUID(); follow(id, choice) }
    const message = withPointed(text, pointed)
    setPending(message)
    setSentAt(Date.now())
    setPointed(null)
    api.sendMessage(id, message)
    // words of the source asked about are words not known yet: Session asks about them (docs/session.md §3)
    if (pointed?.side === "source") api.pickWords({ segmentId: pointed.segmentId, quote: pointed.quote, origin: "asked" }).catch(() => undefined)
  }, [convId, follow, choice, pointed])

  // Claude's changes in this conversation, and whether each still stands: asked of the server for the writes that
  // went through, and again when anyone takes a change back
  const writes = view.state.items.flatMap((i) => (i.kind === "tool" && WRITE_TOOLS.has(i.name) && i.status === "done" ? [i.id] : []))
  const writesKey = writes.join(",")
  const [changes, setChanges] = useState<{ key: string; undone: Map<string, boolean> } | null>(null)
  const refreshChanges = useCallback(() => {
    const ids = writesKey ? writesKey.split(",") : []
    if (!ids.length) return
    api.claudeChanges(ids).then((rows) => setChanges({ key: writesKey, undone: new Map(rows.map((r) => [r.toolUseId, r.undone])) })).catch(() => undefined)
  }, [writesKey])
  useEffect(() => { refreshChanges() }, [refreshChanges])
  useEffect(() => api.watchChanges((c) => { if (c.kind !== "do" && c.kind !== "suggested") refreshChanges() }), [refreshChanges])
  /** Whether a write of this conversation still stands: true, false, or null while not yet known. A write that went
   *  through and has no change logged any more was taken back (Claude's next change ended its redo). */
  const stands = useCallback(
    (toolUseId: string) => (changes?.key !== writesKey ? null : changes.undone.has(toolUseId) ? !changes.undone.get(toolUseId) : false),
    [changes, writesKey],
  )
  /** Take back these changes of Claude's; the reason when they cannot be. */
  const undoFrom = useCallback(async (toolUseIds: string[]) => {
    try {
      await api.undoClaude(toolUseIds)
      refreshChanges()
      return null
    } catch (e) {
      if ((e as { status?: number }).status === 409) return (e as Error).message
      throw e
    }
  }, [refreshChanges])

  // What the checks found in each turn (docs/agent.md §19), by the translator's message that began it: the app's
  // record, asked for whenever a turn ends, so a conversation opened again shows the same
  const sessionId = view.state.sessionId
  const turnsEnded = view.state.items.filter((i) => i.kind === "turn").length
  const [checks, setChecks] = useState<{ sessionId: string; byUser: Map<string, TurnChecks> } | null>(null)
  useEffect(() => {
    if (!sessionId || !turnsEnded) return
    api.turnChecks(sessionId).then((rows) => setChecks({ sessionId, byUser: new Map(rows.map((r) => [r.userUuid, r.checks])) })).catch(() => undefined)
  }, [sessionId, turnsEnded])
  const checksOf = useCallback((userUuid: string) => (checks?.sessionId === sessionId ? checks.byUser.get(userUuid) ?? null : null), [checks, sessionId])

  const summary = list.find((c) => c.id === convId) ?? null
  // what the next message goes to: a new conversation's choice; a begun one's as the server says, or as the list said
  // until the server has
  const shown = convId === null ? choice : view.config ?? (summary ? { model: summary.model, effort: summary.effort } : choice)
  const config = useMemo(() => ({ model: shown.model, effort: shown.effort }), [shown.model, shown.effort])
  const configure = useCallback((change: { model?: string; effort?: string }) => {
    if (convId) api.configureConversation(convId, change)
    else setChoice((c) => ({ ...c, ...change }))
  }, [convId])
  return useMemo(() => ({
    convId, view, list, models, summary, config, configure, pointed, point: setPointed, pending, sentAt,
    refreshList, send, stands, undoFrom, checksOf,
    open: (id: string) => follow(id),
    newConversation: () => { unfollow.current?.(); unfollow.current = null; setConvId(null); setView(emptyView()); setPending(null) },
    stop: () => { if (convId) api.stopTurn(convId) },
    answer: (requestId: string, decision: AskDecision) => { if (convId) api.answerAsk(convId, requestId, decision) },
  }), [convId, view, list, models, summary, config, configure, pointed, pending, sentAt, refreshList, send, stands, undoFrom, checksOf, follow])
}

export type Claude = ReturnType<typeof useClaude>
