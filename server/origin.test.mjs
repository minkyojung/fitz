import assert from "node:assert/strict"
import { test } from "node:test"

import { corsHeaders, fromThisMachine, localHost, localOrigin } from "./origin.mjs"

test("pages of this machine are local; other sites, look-alikes and opaque origins are not", () => {
  for (const o of [undefined, "http://localhost:5173", "http://127.0.0.1:4173", "http://[::1]:3000", "https://localhost"]) assert.equal(localOrigin(o), true, o)
  for (const o of ["https://evil.example", "http://localhost.evil.example", "http://evil.example/localhost", "null", "file://", "localhost:5173"]) assert.equal(localOrigin(o), false, o)
})

test("a request must be addressed to this machine by name: another name is DNS rebinding", () => {
  for (const h of ["localhost:4800", "127.0.0.1:4800", "[::1]:4800", "localhost"]) assert.equal(localHost(h), true, h)
  for (const h of [undefined, "evil.example:4800", "localhost.evil.example", "192.168.0.10:4800"]) assert.equal(localHost(h), false, h)
})

test("the server acts only when both hold; CORS names the page's own origin, never *", () => {
  const req = (host, origin) => ({ headers: { host, ...(origin && { origin }) } })
  assert.equal(fromThisMachine(req("localhost:4800")), true)
  assert.equal(fromThisMachine(req("localhost:4800", "http://localhost:5173")), true)
  assert.equal(fromThisMachine(req("localhost:4800", "https://evil.example")), false)
  assert.equal(fromThisMachine(req("evil.example:4800", "http://evil.example:4800")), false)
  assert.deepEqual(corsHeaders("http://localhost:5173"), { "access-control-allow-origin": "http://localhost:5173", vary: "origin" })
  assert.deepEqual(corsHeaders(undefined), {})
})
