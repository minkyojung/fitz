import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { api } from "./http"
import type { AskDecision, ConversationSummary } from "./api"
import { applyEvent, emptyView, withPointed, type ConversationView, type Pointed } from "@/lib/conversation"

/** The models and efforts offered for a new conversation; the server's defaults first. */
export const MODELS = [
  { id: "claude-opus-5-5", name: "Opus 5.5" },
  { id: "claude-sonnet-5-5", name: "Sonnet 5.5" },
  { id: "claude-haiku-5-5", name: "Haiku 5.5" },
] as const
export const EFFORTS = ["low", "medium", "high"] as const

/** The conversation with Claude the Claude tab shows (docs/agent.md §17). It opens on an empty new conversation, which
 *  begins with its first message; past ones come from the list. What the translator pointed at (Ask Claude) waits
 *  here until it is sent with their words. */
export function useClaude() {
  const [convId, setConvId] = useState<string | null>(null)
  const [view, setView] = useState<ConversationView>(emptyView)
  const [list, setList] = useState<ConversationSummary[]>([])
  const [choice, setChoice] = useState<{ model: string; effort: string }>({ model: MODELS[0].id, effort: "medium" })
  const [pointed, setPointed] = useState<Pointed | null>(null)
  // a message sent and not yet echoed back by Claude Code: the first one waits for its process to start
  const [pending, setPending] = useState<string | null>(null)
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
    setPointed(null)
    api.sendMessage(id, message)
  }, [convId, follow, choice, pointed])

  const summary = list.find((c) => c.id === convId) ?? null
  return useMemo(() => ({
    convId, view, list, summary, choice, setChoice, pointed, point: setPointed, pending,
    refreshList, send,
    open: (id: string) => follow(id),
    newConversation: () => { unfollow.current?.(); unfollow.current = null; setConvId(null); setView(emptyView()); setPending(null) },
    stop: () => { if (convId) api.stopTurn(convId) },
    answer: (requestId: string, decision: AskDecision) => { if (convId) api.answerAsk(convId, requestId, decision) },
  }), [convId, view, list, summary, choice, pointed, pending, refreshList, send, follow])
}

export type Claude = ReturnType<typeof useClaude>
