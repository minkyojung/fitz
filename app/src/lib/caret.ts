/** Where in the document a click on its read view landed: the editor opens with the caret there. */
export function caretAt(event: React.MouseEvent<HTMLElement>): number | "end" {
  const range = document.caretRangeFromPoint(event.clientX, event.clientY)
  const paragraphs = [...event.currentTarget.querySelectorAll("p")]
  const p = range ? paragraphs.findIndex((el) => el.contains(range.startContainer)) : -1
  if (!range || p === -1) return "end"
  const before = document.createRange()
  before.setStart(paragraphs[p]!, 0)
  before.setEnd(range.startContainer, range.startOffset)
  // a paragraph costs one position to open and one to close
  return paragraphs.slice(0, p).reduce((pos, el) => pos + (el.textContent?.length ?? 0) + 2, 1 + before.toString().length)
}
