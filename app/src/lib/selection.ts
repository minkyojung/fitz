/** One selection model for every text surface. The floating toolbar reads this and nothing else. */

export interface TextSelection {
  segmentId: number
  side: "source" | "target"
  /** Selected text and its offsets inside the block's plain text. */
  text: string
  start: number
  end: number
  /** Where the selected words are on screen, measured when asked (a Floating UI virtual element): the toolbar follows
   *  them when the list scrolls. `contextElement` is an element they sit in, so the popover hears the list scroll. */
  anchor: { getBoundingClientRect: () => DOMRect; contextElement: Element }
  /** Where it came from: a read-only block (DOM selection) or the open editor. */
  origin: "dom" | "editor"
}
