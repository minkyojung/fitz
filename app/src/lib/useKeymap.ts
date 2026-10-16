import { useEffect } from "react"

import { commandFor, isTypingTarget } from "./keymap"

/** Dispatch window key events to named commands. Nothing fires while an input has focus,
 *  except Escape, which is how editing ends. */
export function useKeymap(commands: Record<string, (() => unknown) | undefined>) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const name = commandFor(e)
      if (!name) return
      if (isTypingTarget(e.target as HTMLElement | null) && name !== "cancelEdit") return
      const fn = commands[name]
      if (!fn) return
      e.preventDefault()
      void fn()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [commands])
}
