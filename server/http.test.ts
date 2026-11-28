// The server as a page meets it: over real HTTP on 127.0.0.1, against the development copy of the book.
import assert from "node:assert/strict"
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { request, type IncomingHttpHeaders, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { after, before, describe, test } from "node:test"

import { Hello, PROTOCOL_VERSION } from "../shared/protocol.ts"
import { openBook, type BookReader } from "./book.ts"
import { COOKIE, createBookServer } from "./http.ts"

const ROOT = resolve(import.meta.dirname, "..")
const COPY = process.env.FITZ_DB ?? join(ROOT, "dev-data/out/book.db")
const TOKEN = "t".repeat(48)
const BOOT = "boot-under-test"

interface Reply { status: number; headers: IncomingHttpHeaders; text: string; json: () => any }
interface Call { method?: string; headers?: Record<string, string>; body?: string | Buffer; auth?: boolean }

describe("the server over HTTP", () => {
  let dir: string
  let book: BookReader
  let server: Server
  let port: number

  /** One request, written out by hand: the path and the Host header go exactly as given. */
  const call = (path: string, { method = "GET", headers = {}, body, auth = true }: Call = {}) =>
    new Promise<Reply>((done, fail) => {
      const req = request(
        { host: "127.0.0.1", port, path, method, headers: { ...(auth ? { authorization: `Bearer ${TOKEN}` } : {}), ...headers } },
        (res) => {
          const chunks: Buffer[] = []
          res.on("data", (c: Buffer) => chunks.push(c))
          res.on("end", () => {
            const text = Buffer.concat(chunks).toString("utf8")
            done({ status: res.statusCode ?? 0, headers: res.headers, text, json: () => JSON.parse(text) })
          })
        },
      )
      req.on("error", fail)
      req.end(body)
    })
  const api = (name: string, params?: unknown, more: Call = {}) =>
    call(`/api/${name}`, { method: "POST", body: params === undefined ? undefined : JSON.stringify(params), ...more, headers: { "content-type": "application/json", ...more.headers } })

  before(async () => {
    assert.ok(existsSync(COPY), `no development copy at ${COPY} — make it with: scripts/dev-data.sh`)
    dir = mkdtempSync(join(tmpdir(), "fitz-http-"))
    mkdirSync(join(dir, "client/assets"), { recursive: true })
    writeFileSync(join(dir, "client/index.html"), "<!doctype html><title>fitz</title>")
    writeFileSync(join(dir, "client/assets/app-abc123.js"), "console.log('fitz')")
    writeFileSync(join(dir, "client/assets/style-abc123.css"), "body{}")
    writeFileSync(join(dir, "secret.txt"), "outside the page folder")
    book = openBook(COPY)
    server = createBookServer({ book, token: TOKEN, clientDir: join(dir, "client"), bootId: BOOT })
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done))
    port = (server.address() as AddressInfo).port
  })
  after(async () => {
    await new Promise((done) => server?.close(done))
    book?.close()
    if (dir) rmSync(dir, { recursive: true, force: true })
  })

  test("it listens on 127.0.0.1 only", () => {
    assert.equal((server.address() as AddressInfo).address, "127.0.0.1")
  })

  test("nothing is given without the token", async () => {
    for (const path of ["/", "/assets/app-abc123.js", "/nothing"]) assert.equal((await call(path, { auth: false })).status, 401, path)
    assert.equal((await api("getBook", {}, { auth: false })).status, 401)
    assert.equal((await api("hello", { protocol: PROTOCOL_VERSION }, { auth: false })).status, 401)
    assert.equal((await api("getBook", {}, { auth: false, headers: { authorization: "Bearer wrong" } })).status, 401)
    assert.equal((await api("getBook", {}, { auth: false, headers: { authorization: `Bearer ${TOKEN}x` } })).status, 401)
    assert.equal((await api("getBook", {}, { auth: false, headers: { cookie: `${COOKIE}=wrong` } })).status, 401)
    const refused = await api("getBook", {}, { auth: false })
    assert.ok(!refused.text.includes(TOKEN) && !refused.text.includes("Fish"), "a refusal says nothing of the book or the token")
  })

  test("the token in the first address becomes a cookie, and the address loses it", async () => {
    const wrong = await call("/?token=nope", { auth: false })
    assert.equal(wrong.status, 401)
    assert.equal(wrong.headers["set-cookie"], undefined)

    const door = await call(`/?token=${TOKEN}`, { auth: false })
    assert.equal(door.status, 302)
    assert.equal(door.headers.location, "/")
    const cookie = door.headers["set-cookie"]?.[0] ?? ""
    assert.match(cookie, new RegExp(`^${COOKIE}=${TOKEN};`))
    assert.match(cookie, /HttpOnly/)
    assert.match(cookie, /SameSite=Strict/)
    assert.match(cookie, /Path=\//)

    const signedIn = { auth: false, headers: { cookie: `other=1; ${COOKIE}=${TOKEN}` } }
    assert.equal((await call("/", signedIn)).status, 200)
    assert.equal((await api("getBook", {}, signedIn)).status, 200)
  })

  test("a request for another host or from another origin is refused", async () => {
    const here = `127.0.0.1:${port}`
    assert.equal((await api("getBook", {}, { headers: { host: here } })).status, 200)
    for (const host of ["evil.example", `localhost:${port}`, `evil.example:${port}`, "127.0.0.1", `127.0.0.1:${port + 1}`])
      assert.equal((await api("getBook", {}, { headers: { host } })).status, 403, `host ${host}`)
    assert.equal((await api("getBook", {}, { headers: { origin: `http://${here}` } })).status, 200)
    for (const origin of ["http://evil.example", `http://localhost:${port}`, `https://${here}`, "null"])
      assert.equal((await api("getBook", {}, { headers: { origin } })).status, 403, `origin ${origin}`)
  })

  test("hello gives the boot id and refuses another protocol", async () => {
    const ok = await api("hello", { protocol: PROTOCOL_VERSION })
    assert.equal(ok.status, 200)
    assert.deepEqual(Hello.parse(ok.json()), { protocol: PROTOCOL_VERSION, bootId: BOOT, revision: 0 })
    const other = await api("hello", { protocol: PROTOCOL_VERSION + 1 })
    assert.equal(other.status, 409)
    assert.match(other.json().error, /protocol/)
    assert.equal((await api("hello", {})).status, 400)
    assert.equal((await api("hello", { protocol: "1" })).status, 400)
  })

  test("the three requests answer what the book answers", async () => {
    const got = await api("getBook", {})
    assert.equal(got.status, 200)
    assert.match(got.headers["content-type"] ?? "", /^application\/json; charset=utf-8/)
    assert.equal(got.headers["cache-control"], "no-store")
    assert.deepEqual(got.json(), book.getBook())

    assert.deepEqual((await api("listChapters", {})).json(), book.listChapters())
    assert.deepEqual((await api("listChapters")).json(), book.listChapters(), "no body is no params")
    let paragraphs = 0
    for (const c of book.listChapters()) {
      const segments = (await api("listSegments", { chapterId: c.id })).json()
      assert.deepEqual(segments, book.listSegments(c.id), `chapter ${c.id}`)
      paragraphs += segments.length
    }
    assert.equal(paragraphs, book.listChapters().reduce((n, c) => n + c.segmentCount, 0))
  })

  test("Korean arrives as it is stored", async () => {
    const translated = book.listChapters().find((c) => c.translatedCount > 0)
    assert.ok(translated, "the copy has a translated chapter")
    const sent = (await api("listSegments", { chapterId: translated.id })).json().find((s: { targetText: string | null }) => s.targetText !== null)
    assert.match(sent.targetText, /[가-힣]/)
    assert.equal(sent.targetText, book.listSegments(translated.id).find((s) => s.id === sent.id)?.targetText)
  })

  test("what cannot be answered says why, with the right status", async () => {
    const error = async (reply: Promise<Reply>, status: number) => {
      const r = await reply
      assert.equal(r.status, status, r.text)
      assert.equal(typeof r.json().error, "string")
    }
    await error(api("listSegments", { chapterId: "1" }), 400)
    await error(api("listSegments", {}), 400)
    await error(api("listSegments", { chapterId: 999_999_999 }), 404)
    await error(api("dropEverything", {}), 404)
    await error(api("toString", {}), 404)
    await error(api("", {}), 404)
    await error(call("/api/getBook", { method: "POST", body: "{not json", headers: { "content-type": "application/json" } }), 400)
    await error(call("/api/getBook", { method: "POST", body: "[1]", headers: { "content-type": "application/json" } }), 400)
    await error(call("/api/getBook", { method: "POST", body: "{}", headers: { "content-type": "text/plain" } }), 415)
    await error(call("/api/getBook"), 405)
    await error(call("/api/getBook", { method: "DELETE" }), 405)
    await error(call("/", { method: "POST", body: "{}", headers: { "content-type": "application/json" } }), 405)
    await error(api("getBook", undefined, { body: Buffer.alloc(1_100_000, 0x20) }), 413)
    assert.equal((await api("getBook", {})).status, 200, "the server still answers after refusals")
  })

  test("the page's files are served, and nothing outside its folder", async () => {
    const index = await call("/")
    assert.equal(index.status, 200)
    assert.equal(index.text, "<!doctype html><title>fitz</title>")
    assert.match(index.headers["content-type"] ?? "", /^text\/html; charset=utf-8/)
    assert.equal(index.headers["cache-control"], "no-cache")
    assert.match(String(index.headers["content-security-policy"]), /default-src 'self'/)
    assert.equal(index.headers["x-content-type-options"], "nosniff")

    const js = await call("/assets/app-abc123.js")
    assert.equal(js.status, 200)
    assert.match(js.headers["content-type"] ?? "", /^text\/javascript/)
    assert.match(js.headers["cache-control"] ?? "", /immutable/)
    assert.match((await call("/assets/style-abc123.css")).headers["content-type"] ?? "", /^text\/css/)

    assert.equal((await call("//secret.txt")).status, 404, "a path with two slashes is a path, not another host")
    assert.equal((await call("http://evil.example/")).status, 400, "an address that is not a path is refused")
    for (const path of ["/missing.js", "/assets", "/assets/", "/../secret.txt", "/..%2fsecret.txt", "/%2e%2e/secret.txt", "/assets/../../secret.txt", "/assets/..%2f..%2fsecret.txt", "//secret.txt", "/%00"]) {
      const r = await call(path)
      assert.ok(r.status === 404 || r.status === 400, `${path} → ${r.status}`)
      assert.ok(!r.text.includes("outside the page folder"), path)
    }
  })
})
