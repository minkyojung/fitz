import type { Chapter } from "@shared/protocol.ts"

/** The chapter a printed page belongs to: a chapter runs from its start page to the next chapter's. null for the
 *  pages before the first chapter (front matter). Chapters are in book order. */
export function chapterForPage(chapters: Chapter[], pageNo: number): Chapter | null {
  let found: Chapter | null = null
  for (const chapter of chapters) if (chapter.startPage !== null && chapter.startPage <= pageNo) found = chapter
  return found
}
