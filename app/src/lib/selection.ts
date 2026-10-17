/** One selection model for every text surface. The floating toolbar reads this and nothing else. */

export interface TextSelection {
  segmentId: number
  side: "source" | "target"
  /** Selected text and its offsets inside the block's plain text. */
  text: string
  start: number
  end: number
  /** Viewport rectangle of the selection, for anchoring the toolbar. */
  rect: { x: number; y: number; width: number; height: number }
  /** Where it came from: a read-only block (DOM selection) or the open editor. */
  origin: "dom" | "editor"
}
