// The /agent WebSocket: page messages in (checked by protocol.mjs), conversation events out. One socket per page;
// it follows the conversations it started or opened.
import { WebSocketServer } from "ws"

import { parseClientMessage } from "./protocol.mjs"

/** Only pages served from this machine may talk to the agent; a page on any other site could otherwise drive it
 *  and read the book through it. A client without an Origin (the terminal chat, tests) is not a browser page. */
export const localOrigin = (origin) => origin === undefined || /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origin)

export function attachAgentSocket(server, host) {
  const wss = new WebSocketServer({ server, path: "/agent", maxPayload: 256 * 1024, verifyClient: ({ origin }) => localOrigin(origin) })
  wss.on("connection", (ws) => {
    const following = new Map()  // convId → stop following
    const send = (event) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(event)) }
    // following again sends a fresh snapshot
    const follow = (convId) => { following.get(convId)?.(); following.set(convId, host.open(convId, send)) }
    ws.on("message", (raw) => {
      let m
      try {
        m = parseClientMessage(String(raw))
        if (m.type === "start") { host.start(m.convId, m); follow(m.convId) }
        else if (m.type === "open") follow(m.convId)
        else if (m.type === "send") host.send(m.convId, m.text)
        else if (m.type === "stop") host.stop(m.convId)
      } catch (e) {
        send({ type: "error", ...(m?.convId && { convId: m.convId }), message: e.message })
      }
    })
    ws.on("close", () => { for (const stop of following.values()) stop() })
  })
  return wss
}
