import type { Api, BookChange, ConversationSummary } from "./api"
import { createLive } from "@/lib/live"
import { nextRun, type TaskRun } from "@/lib/taskRun"

const BASE = import.meta.env.VITE_API_URL ?? "http://localhost:4800"

async function call<T>(method: string, body: unknown = {}): Promise<T> {
  const res = await fetch(`${BASE}/api/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
  const data = await res.json()
  if (!res.ok) throw Object.assign(new Error(data?.error ?? `${method} failed (${res.status})`), { status: res.status })
  return data as T
}

/** Same request as `call`, but the body is a file; the name comes from content-disposition. */
async function callBlob(method: string, body: unknown = {}): Promise<{ blob: Blob; filename: string }> {
  const res = await fetch(`${BASE}/api/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => null)
    throw new Error(data?.error ?? `${method} failed (${res.status})`)
  }
  const m = res.headers.get("content-disposition")?.match(/filename\*=UTF-8''([^;]+)/)
  return { blob: await res.blob(), filename: m ? decodeURIComponent(m[1]) : "export.docx" }
}

export const pageImageUrl = (url: string) => `${BASE}${url}`

/** The page's one live connection (docs/agent.md §15), opened on first use and kept for the page's life. */
let shared: ReturnType<typeof createLive> | null = null
const live = () => (shared ??= createLive(`${BASE.replace(/^http/, "ws")}/live`))

export const api: Api = {
  getBook: () => call("getBook"),
  listChapters: () => call("listChapters"),
  listSegments: (chapterId) => call("listSegments", { chapterId }),
  listPages: () => call("listPages"),
  updateSegment: (id, { expectVersion, ...patch }) => call("updateSegment", { id, patch, expectVersion }),
  splitSegment: (id, offset) => call("splitSegment", { id, offset }),
  mergeWithNext: (id) => call("mergeWithNext", { id }),
  listUnanchoredNotes: () => call("listUnanchoredNotes"),
  listAnnotations: (chapterId) => call("listAnnotations", { chapterId }),
  addComment: (input) => call("addComment", input),
  setComment: (input) => call("setComment", input),
  deleteComment: (id) => call("deleteComment", { id }),
  addNote: (input) => call("addNote", input),
  setNote: (input) => call("setNote", input),
  deleteNote: (id) => call("deleteNote", { id }),
  anchorNote: (noteId, segmentId) => call("anchorNote", { noteId, segmentId }),
  insertSegment: (input) => call("insertSegment", input),
  undo: () => call("undo"),
  redo: () => call("redo"),
  listOps: (segmentId) => call("listOps", { segmentId }),
  search: (query) => call("search", { query }),
  listGlossaryWords: (bookId) => call("listGlossaryWords", { bookId }),
  addGlossaryWord: (bookId, term) => call("addGlossaryWord", { bookId, term }),
  listGlossary: (bookId) => call("listGlossary", { bookId }),
  setGlossaryTerm: (input) => call("setGlossaryTerm", input),
  listSourceTexts: () => call("listSourceTexts"),
  replaceAll: (query, replacement) => call("replaceAll", { query, replacement }),
  exportSummary: (input) => call("exportSummary", input),
  exportDocx: (input) => callBlob("exportDocx", input),
  // after the connection comes back, some changes may have been missed
  watchChanges: (onChange) =>
    live().subscribe((e) => {
      if (e.type === "resync") onChange({ kind: "resync" })
      else if (e.type === "changed") onChange(e as unknown as BookChange)
      else if (e.type === "suggested") onChange({ kind: "suggested", segmentIds: e.segmentIds as number[] })
    }),
  listSuggestions: (chapterId) => call("listSuggestions", { chapterId }),
  decideSuggestion: (id, decision) => call("decideSuggestion", { id, decision }),
  runTask: (task, chapterId, onRun) => {
    const convId = crypto.randomUUID()
    const connection = live()
    let run: TaskRun = { state: "running" }
    const stop = connection.subscribe((e) => {
      // following ends with the connection: follow again, and the snapshot tells whether it ended meanwhile
      if (e.type === "resync") return connection.send({ type: "open", convId })
      if (e.convId !== convId) return
      const next = nextRun(run, e)
      if (next === run) return
      run = next
      onRun(run)
      if (run.state !== "running") stop()
    })
    connection.send({ type: "start", convId, task, chapterId })
    onRun(run)
    return stop
  },
  listConversations: () =>
    new Promise((resolve, reject) => {
      const connection = live()
      const timer = setTimeout(() => { stop(); reject(new Error("the server did not answer with the conversations")) }, 10_000)
      const stop = connection.subscribe((e) => {
        if (e.type !== "conversations") return
        clearTimeout(timer)
        stop()
        resolve(e.items as ConversationSummary[])
      })
      connection.send({ type: "list" })
    }),
  followConversation: (convId, onEvent, start) => {
    const connection = live()
    const stop = connection.subscribe((e) => {
      // following ends with the connection: follow again, and the snapshot brings what was missed
      if (e.type === "resync") return connection.send({ type: "open", convId })
      if (e.convId === convId) onEvent(e)
    })
    connection.send(start ? { type: "start", convId, ...start } : { type: "open", convId })
    return stop
  },
  sendMessage: (convId, text) => live().send({ type: "send", convId, text }),
  stopTurn: (convId) => live().send({ type: "stop", convId }),
  configureConversation: (convId, change) => live().send({ type: "configure", convId, ...change }),
  answerAsk: (convId, requestId, decision) => live().send({ type: "answer", convId, requestId, decision }),
  undoClaude: (toolUseIds) => call("undoClaude", { toolUseIds }),
  claudeChanges: (toolUseIds) => call("claudeChanges", { toolUseIds }),
  turnChecks: (sessionId) => call("turnChecks", { sessionId }),
}
