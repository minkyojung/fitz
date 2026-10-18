/** The page's live connection to the server (docs/agent.md §15): one WebSocket for everything that moves. It
 *  reconnects by itself, waiting longer each time it fails; after a reconnect its listeners hear { type: "resync" },
 *  since whatever happened while it was down was missed. What is sent while it is not open waits and goes, in order,
 *  once it is. */
export type LiveEvent = { type: string } & Record<string, unknown>

/** The part of the browser's WebSocket this uses; tests pass a stand-in. Handlers take `never` so the browser's
 *  (Event-taking) WebSocket fits while this file assigns plainer functions. */
export interface SocketLike {
  onopen: ((e: never) => void) | null
  onmessage: ((m: never) => void) | null
  onclose: ((e: never) => void) | null
  onerror: ((e: never) => void) | null
  send(data: string): void
  close(): void
}

export interface LiveOptions {
  socket?: (url: string) => SocketLike
  /** Waits before each reconnect; the last repeats. */
  delays?: number[]
}

export function createLive(url: string, { socket = (u) => new WebSocket(u), delays = [500, 1000, 2000, 5000] }: LiveOptions = {}) {
  const listeners = new Set<(e: LiveEvent) => void>()
  let current: SocketLike | null = null
  let open = false
  const waiting: string[] = []
  let failures = 0
  let opened = false
  let closed = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const emit = (e: LiveEvent) => { for (const l of listeners) l(e) }

  function connect() {
    const ws = socket(url)
    current = ws
    ws.onopen = () => {
      failures = 0
      open = true
      for (const data of waiting.splice(0)) ws.send(data)
      if (opened) emit({ type: "resync" })
      opened = true
    }
    ws.onmessage = (m: { data: unknown }) => {
      let event: unknown
      try { event = JSON.parse(String(m.data)) } catch { return }
      if (event && typeof event === "object" && typeof (event as LiveEvent).type === "string") emit(event as LiveEvent)
    }
    ws.onerror = () => undefined  // onclose follows
    ws.onclose = () => {
      current = null
      open = false
      if (closed) return
      timer = setTimeout(connect, delays[Math.min(failures++, delays.length - 1)])
    }
  }
  connect()

  return {
    /** Hear every event. Returns the function that stops listening. */
    subscribe(fn: (e: LiveEvent) => void) { listeners.add(fn); return () => { listeners.delete(fn) } },
    send(message: { type: string } & Record<string, unknown>) {
      const data = JSON.stringify(message)
      if (open && current) current.send(data)
      else waiting.push(data)
    },
    close() { closed = true; clearTimeout(timer); current?.close() },
  }
}
