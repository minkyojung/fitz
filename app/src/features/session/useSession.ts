import { useCallback, useEffect, useState } from "react"

import type { SessionDay } from "@/data/api"
import { api } from "@/data/http"

/** Session's day as the server has it (docs/session.md), asked again when Session changes (an answer, a run), after a
 *  reconnect, when the book changes (a corrected source or translation can take a card out), and when the window
 *  comes back — the day may have turned while it was away. */
export function useSession() {
  const [day, setDay] = useState<SessionDay | null>(null)
  const [error, setError] = useState<string | null>(null)
  const reload = useCallback(async () => {
    try {
      const next = await api.sessionToday()
      setDay(next)
      setError(null)
      return next
    } catch (e) {
      setError((e as Error).message)
      return null
    }
  }, [])
  useEffect(() => {
    const load = () => void reload()
    load()
    const stopSession = api.watchSession(load)
    const stopBook = api.watchChanges((change) => { if (change.kind !== "suggested") load() })
    window.addEventListener("focus", load)
    return () => { stopSession(); stopBook(); window.removeEventListener("focus", load) }
  }, [reload])
  /** What is left to do today: the sidebar's badge. */
  const left = day ? day.cards.length + day.challenges.length : 0
  return { day, error, reload, left }
}
