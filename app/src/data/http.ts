import type { Api } from "./api"

const BASE = import.meta.env.VITE_API_URL ?? "http://localhost:4800"

async function call<T>(method: string, body: unknown = {}): Promise<T> {
  const res = await fetch(`${BASE}/api/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data?.error ?? `${method} failed (${res.status})`)
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

export const api: Api = {
  getBook: () => call("getBook"),
  listChapters: () => call("listChapters"),
  listSegments: (chapterId) => call("listSegments", { chapterId }),
  listPages: () => call("listPages"),
  updateSegment: (id, patch) => call("updateSegment", { id, patch }),
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
}
