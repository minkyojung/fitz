// GET /api/events: the book's changes as server-sent events (docs/agent.md §12). One event per committed write —
// the translator's, the agent's, an undo — so an open editor shows what another writer did. Server-sent events
// because the stream goes one way and the browser's EventSource reconnects by itself. Events carry no SSE id:
// nothing is replayed on reconnect (an undo shares its op's id anyway); a page that reconnects reloads what it shows.
import { watchChanges } from "./commands.mjs"
import { localOrigin } from "./origin.mjs"

export const HEARTBEAT_MS = 30_000

export function serveChanges(db, req, res) {
  const origin = req.headers.origin
  if (!localOrigin(origin)) { res.writeHead(403).end(); return }
  res.writeHead(200, {
    "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive",
    ...(origin && { "access-control-allow-origin": origin }),
  })
  res.write("retry: 2000\n\n")
  const stop = watchChanges(db, (change) => res.write(`event: change\ndata: ${JSON.stringify(change)}\n\n`))
  const heartbeat = setInterval(() => res.write(": alive\n\n"), HEARTBEAT_MS)
  req.on("close", () => { stop(); clearInterval(heartbeat) })
}
