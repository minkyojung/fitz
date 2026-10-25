// The page's live connection (docs/agent.md §15): one WebSocket per page at /live, for everything that moves —
// the book's changes, whoever made them, and the agent's conversations. Book actions stay plain HTTP requests.
// Page messages are checked by agent/protocol.mjs; nothing the page sends is trusted.
import { WebSocketServer } from "ws"

import { watchChanges } from "./commands.mjs"
import { parseClientMessage } from "./agent/protocol.mjs"
import { watchSuggestions } from "./agent/suggestions.mjs"
import { watchSession } from "./drill/cards.mjs"
import { localHost, localOrigin } from "./origin.mjs"

export const HEARTBEAT_MS = 30_000

export function attachLive(server, { db, host, heartbeatMs = HEARTBEAT_MS }) {
  const wss = new WebSocketServer({ server, path: "/live", maxPayload: 256 * 1024, verifyClient: ({ origin, req }) => localOrigin(origin) && localHost(req.headers.host) })
  // a page that went away without closing (sleep, a dropped network) is found by its missing pong and let go
  const alive = new WeakSet()
  const beat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!alive.has(ws)) { ws.terminate(); continue }
      alive.delete(ws)
      ws.ping()
    }
  }, heartbeatMs)
  beat.unref()
  wss.on("close", () => clearInterval(beat))

  wss.on("connection", (ws) => {
    alive.add(ws)
    ws.on("pong", () => alive.add(ws))
    const send = (event) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(event)) }
    // every page hears every change to the book
    const unwatch = watchChanges(db, (change) => send({ type: "changed", ...change }))
    const unwatchSuggestions = watchSuggestions(db, (change) => send({ type: "suggested", ...change }))
    const unwatchSession = watchSession(db, (change) => send({ type: "session", ...change }))
    const following = new Map()  // convId → stop following
    // following again sends a fresh snapshot
    const follow = (convId) => { following.get(convId)?.(); following.set(convId, host.open(convId, send)) }
    ws.on("message", async (raw) => {
      let m
      try {
        m = parseClientMessage(String(raw))
        if (m.type === "start") { host.start(m.convId, m); follow(m.convId) }
        else if (m.type === "open") follow(m.convId)
        else if (m.type === "list") send({ type: "conversations", items: host.list() })
        else if (m.type === "models") send({ type: "models", items: host.models() })
        else if (m.type === "send") await host.send(m.convId, m.text)
        else if (m.type === "stop") host.stop(m.convId)
        else if (m.type === "context") host.context(m.convId).then((usage) => send({ type: "context", convId: m.convId, usage }))
        else if (m.type === "compact") host.compact(m.convId)
        else if (m.type === "configure") await host.configure(m.convId, m)
        else if (m.type === "answer") host.answer(m.convId, m.requestId, m.decision)
      } catch (e) {
        send({ type: "error", ...(m?.convId && { convId: m.convId }), message: e.message })
      }
    })
    ws.on("close", () => { unwatch(); unwatchSuggestions(); unwatchSession(); for (const stop of following.values()) stop() })
  })
  return wss
}
