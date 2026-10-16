/** One table from key chord → command name. Pure; the DOM hook lives in useKeymap.ts. */

export interface Chord {
  key: string
  meta?: boolean
  shift?: boolean
}

export const KEYMAP: Record<string, Chord[]> = {
  selectNext: [{ key: "ArrowDown" }, { key: "j" }],
  selectPrev: [{ key: "ArrowUp" }, { key: "k" }],
  toggleVerified: [{ key: " " }],
  startEdit: [{ key: "Enter" }],
  cancelEdit: [{ key: "Escape" }],
  undo: [{ key: "z", meta: true }],
  redo: [{ key: "z", meta: true, shift: true }],
}

export interface KeyLike {
  key: string
  metaKey: boolean
  ctrlKey: boolean
  shiftKey: boolean
}

/** Command for a key event, or null. Cmd on macOS and Ctrl elsewhere both count as `meta`. */
export function commandFor(e: KeyLike, keymap = KEYMAP): string | null {
  const meta = e.metaKey || e.ctrlKey
  for (const [name, chords] of Object.entries(keymap)) {
    for (const c of chords) {
      const keyMatches = c.key.length === 1 ? e.key.toLowerCase() === c.key : e.key === c.key
      if (keyMatches && Boolean(c.meta) === meta && Boolean(c.shift) === e.shiftKey) return name
    }
  }
  return null
}

/** Global shortcuts must not fire while the person is typing. */
export function isTypingTarget(target: { tagName?: string; isContentEditable?: boolean } | null): boolean {
  if (!target) return false
  if (target.isContentEditable) return true
  return ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName ?? "")
}

/** Human label for the status bar. */
export function chordLabel(c: Chord): string {
  const parts: string[] = []
  if (c.meta) parts.push("⌘")
  if (c.shift) parts.push("⇧")
  parts.push({ " ": "Space", ArrowDown: "↓", ArrowUp: "↑", Escape: "Esc" }[c.key] ?? c.key.toUpperCase())
  return parts.join("")
}
