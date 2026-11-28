import { useEffect, useEffectEvent, useState } from "react"

export type Load<T> =
  | { status: "loading" }
  | { status: "error"; error: Error; retry: () => void }
  | { status: "ready"; data: T }

/** What `load` gives for `key`, loaded again when the key changes. An answer for a key no longer asked for is dropped. */
export function useLoad<T>(key: string | number, load: (signal: AbortSignal) => Promise<T>): Load<T> {
  const [attempt, setAttempt] = useState(0)
  const [settled, setSettled] = useState<{ id: string; result: { data: T } | { error: Error } } | null>(null)
  const id = `${key}:${attempt}`
  const run = useEffectEvent(load)

  useEffect(() => {
    const abort = new AbortController()
    run(abort.signal).then(
      (data) => { if (!abort.signal.aborted) setSettled({ id, result: { data } }) },
      (error: unknown) => { if (!abort.signal.aborted) setSettled({ id, result: { error: error instanceof Error ? error : new Error(String(error)) } }) },
    )
    return () => abort.abort()
  }, [id])

  if (settled?.id !== id) return { status: "loading" }
  if ("error" in settled.result) return { status: "error", error: settled.result.error, retry: () => setAttempt((n) => n + 1) }
  return { status: "ready", data: settled.result.data }
}
