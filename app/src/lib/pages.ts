/** Which chapter a printed page belongs to. Chapters are ranges [startPage, nextStartPage). */

export interface ChapterRange {
  id: number
  startPage: number | null
}

export function chapterForPage(chapters: ChapterRange[], pageNo: number): number | null {
  const ordered = chapters
    .filter((c): c is ChapterRange & { startPage: number } => c.startPage !== null)
    .sort((a, b) => a.startPage - b.startPage)
  let found: number | null = null
  for (const c of ordered) {
    if (c.startPage <= pageNo) found = c.id
    else break
  }
  return found
}
