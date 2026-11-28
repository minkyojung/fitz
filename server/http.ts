// The server's one door: HTTP on 127.0.0.1. It gives the page its files and answers the protocol's requests,
// and gives neither to anyone who does not hold this launch's token.
//
// 127.0.0.1 is reachable by every program on the machine and by any web page the person has open, so:
//  - the Host header must be this server's own address (a page elsewhere that resolves its name here is refused);
//  - an Origin header, when there is one, must be this server's own (another site's script is refused);
//  - the token must come with every request: as a cookie, or as `Authorization: Bearer` for tools and tests.
// The shell opens `/?token=…` once; that becomes an HttpOnly cookie and the address loses the token (the way
// Jupyter and VS Code's web server do it), so the page's code never holds it and a WebSocket will carry it too.
import { createHash, timingSafeEqual } from "node:crypto"
import { readFile, stat } from "node:fs/promises"
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"
import { extname, resolve, sep } from "node:path"

import { z } from "zod"

import { HelloParams, PROTOCOL_VERSION, type ErrorBody, type Hello } from "../shared/protocol.ts"
import { answer, type Library } from "./answer.ts"
import { RequestError } from "./book.ts"

export const COOKIE = "fitz_token"
/** More than any request here needs; a body past it is refused unread. */
const MAX_BODY = 1_000_000

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".map": "application/json; charset=utf-8",
}
/** The page may load only what this server gives it. Styles may be inline: the design system sets some that way. */
const CSP = [
  "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data:", "font-src 'self'",
  "connect-src 'self'", "object-src 'none'", "base-uri 'none'", "frame-ancestors 'none'", "form-action 'none'",
].join("; ")
const ALWAYS = { "x-content-type-options": "nosniff", "referrer-policy": "no-referrer" }

export interface BookServerOptions extends Library {
  /** The book's scanned pages. */
  pagesDir: string
  /** This launch's secret. */
  token: string
  /** The built page. */
  clientDir: string
  /** New each time the server starts. */
  bootId: string
}

/** Not yet listening: the caller chooses the port, always on 127.0.0.1. */
export function createBookServer(options: BookServerOptions): Server {
  return createServer((req, res) => {
    handle(options, req, res).catch((e) => {
      console.error(`${req.method} ${req.url} failed:`, e)
      if (res.headersSent) res.destroy()
      else fail(res, 500, e instanceof Error ? e.message : String(e))
    })
  })
}

const json = (res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) => {
  res.writeHead(status, { ...ALWAYS, "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers })
  res.end(JSON.stringify(body))
}
const fail = (res: ServerResponse, status: number, error: string, headers?: Record<string, string>) =>
  json(res, status, { error } satisfies ErrorBody, headers)

/** Whether two secrets are the same, in time that does not depend on where they differ. */
const same = (a: string, b: string) => {
  const hash = (s: string) => createHash("sha256").update(s).digest()
  return timingSafeEqual(hash(a), hash(b))
}

function holdsToken(req: IncomingMessage, token: string): boolean {
  const bearer = /^Bearer (.+)$/.exec(req.headers.authorization ?? "")?.[1]
  if (bearer !== undefined) return same(bearer, token)
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const at = part.indexOf("=")
    if (at !== -1 && part.slice(0, at).trim() === COOKIE) return same(part.slice(at + 1).trim(), token)
  }
  return false
}

async function handle(o: BookServerOptions, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const here = `127.0.0.1:${req.socket.localPort}`
  if (req.headers.host !== here) return fail(res, 403, "this server answers only at its own address")
  if (req.headers.origin !== undefined && req.headers.origin !== `http://${here}`) return fail(res, 403, "this server answers only its own page")
  // the path as sent, set after this server's own address: read against a base instead, `//x` would name another host
  if (!req.url?.startsWith("/")) return fail(res, 400, "bad address")
  const url = new URL(`http://${here}${req.url}`)

  // the one address that takes the token itself: it is traded for a cookie, and the address loses it
  if (req.method === "GET" && url.pathname === "/" && url.searchParams.has("token")) {
    if (!same(url.searchParams.get("token") ?? "", o.token)) return fail(res, 401, "not this server's token")
    res.writeHead(302, { ...ALWAYS, location: "/", "cache-control": "no-store", "set-cookie": `${COOKIE}=${o.token}; HttpOnly; SameSite=Strict; Path=/` })
    res.end()
    return
  }
  if (!holdsToken(req, o.token)) return fail(res, 401, "not signed in to this server")

  if (url.pathname.startsWith("/api/")) return api(o, url.pathname.slice("/api/".length), req, res)
  if (url.pathname.startsWith("/pages/")) {
    if (req.method !== "GET") return fail(res, 405, "only GET is answered here", { allow: "GET" })
    return page(o.pagesDir, url.pathname.slice("/pages/".length), res)
  }
  if (req.method === "GET") return file(o.clientDir, url.pathname, res)
  return fail(res, 405, "only GET is answered here", { allow: "GET" })
}

async function api(o: BookServerOptions, name: string, req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "POST") return fail(res, 405, "requests are sent with POST", { allow: "POST" })
  if (!/^application\/json\b/.test(req.headers["content-type"] ?? "")) return fail(res, 415, "requests are sent as application/json")
  const body = await read(req)
  // the rest of an oversized body is not read: the connection is closed with the answer
  if (body === null) return fail(res, 413, "the request is too large", { connection: "close" })
  let params: unknown
  try {
    params = body === "" ? {} : JSON.parse(body)
  } catch {
    return fail(res, 400, "the request is not JSON")
  }
  try {
    if (name === "hello") {
      const said = HelloParams.safeParse(params)
      if (!said.success) return fail(res, 400, `hello: ${z.prettifyError(said.error)}`)
      if (said.data.protocol !== PROTOCOL_VERSION)
        return fail(res, 409, `the page speaks protocol ${said.data.protocol} and the server ${PROTOCOL_VERSION}`)
      return json(res, 200, { protocol: PROTOCOL_VERSION, bootId: o.bootId, revision: o.writer.revision() } satisfies Hello)
    }
    return json(res, 200, answer(o, name, params))
  } catch (e) {
    if (e instanceof RequestError) return fail(res, e.status, e.message)
    throw e
  }
}

/** The request's body as text; null once it passes MAX_BODY. */
async function read(req: IncomingMessage): Promise<string | null> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length
    if (size > MAX_BODY) return null
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString("utf8")
}

/** A scanned page's picture. A name and nothing else: no folder, nothing but a PNG, nothing outside the pages folder.
 *  It is the book itself, so it is kept by this browser only (private) — and it never changes, so it is kept a day. */
async function page(pagesDir: string, name: string, res: ServerResponse): Promise<void> {
  let wanted: string
  try {
    wanted = decodeURIComponent(name)
  } catch {
    return fail(res, 400, "bad address")
  }
  if (!/^[\w.-]+\.png$/.test(wanted)) return fail(res, 404, "not found")
  const root = resolve(pagesDir)
  const full = resolve(root, wanted)
  if (!full.startsWith(root + sep)) return fail(res, 404, "not found")
  const found = await stat(full).catch(() => null)
  if (!found?.isFile()) return fail(res, 404, "not found")
  res.writeHead(200, { ...ALWAYS, "content-type": "image/png", "content-length": found.size, "cache-control": "private, max-age=86400" })
  res.end(await readFile(full))
}

async function file(clientDir: string, pathname: string, res: ServerResponse): Promise<void> {
  let wanted: string
  try {
    wanted = decodeURIComponent(pathname)
  } catch {
    return fail(res, 400, "bad address")
  }
  if (wanted.includes("\0")) return fail(res, 400, "bad address")
  const root = resolve(clientDir)
  const full = resolve(root, wanted === "/" ? "index.html" : `.${wanted}`)
  // nothing outside the page's folder, however the address was written
  if (!full.startsWith(root + sep)) return fail(res, 404, "not found")
  const found = await stat(full).catch(() => null)
  if (!found?.isFile()) return fail(res, 404, "not found")
  const type = CONTENT_TYPES[extname(full)] ?? "application/octet-stream"
  res.writeHead(200, {
    ...ALWAYS,
    "content-type": type,
    "content-length": found.size,
    // built assets carry a hash of their content in their name; index.html is the one name that must be asked again
    "cache-control": wanted.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache",
    ...(type.startsWith("text/html") ? { "content-security-policy": CSP } : {}),
  })
  res.end(await readFile(full))
}
