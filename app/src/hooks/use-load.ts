import { useEffect, useEffectEvent, useState } from "react"

export type Load<T> =
  | { status: "loading" }
  | { status: "error"; error: Error; retry: () => void }
  /** `set` puts in what the server has just answered (a saved paragraph), ahead of the next load. */
  | { status: "ready"; data: T; set: (data: T) => void }

/** What `load` gives for `key`. A new key starts over; a new `refresh` loads again while what is there stays on
 *  screen — the book changed, and what is shown is asked for again. An answer for a key no longer asked for is dropped. */
export function useLoad<T>(key: string | number, load: (signal: AbortSignal) => Promise<T>, refresh = 0): Load<T> {
  const [attempt, setAttempt] = useState(0)
  const [settled, setSettled] = useState<{ key: string | number; result: { data: T } | { error: Error } } | null>(null)
  const run = useEffectEvent(load)

  useEffect(() => {
    const abort = new AbortController()
    run(abort.signal).then(
      (data) => { if (!abort.signal.aborted) setSettled({ key, result: { data } }) },
      (error: unknown) => { if (!abort.signal.aborted) setSettled({ key, result: { error: error instanceof Error ? error : new Error(String(error)) } }) },
    )
    return () => abort.abort()
  }, [key, attempt, refresh])

  if (settled?.key !== key) return { status: "loading" }
  if ("error" in settled.result) return { status: "error", error: settled.result.error, retry: () => setAttempt((n) => n + 1) }
  return { status: "ready", data: settled.result.data, set: (data) => setSettled({ key, result: { data } }) }
}
