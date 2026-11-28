import { useEffect, useEffectEvent } from "react"
import { toast } from "sonner"

import { ApiError, request } from "@/data/api"

/** ⌘Z and ⌘⇧Z for the book: the translator's last save taken back, or done again, by the server.
 *  While something is being typed into, the keys are that editor's own and take back typing. */
export function useBookUndo(onChanged: () => void) {
  const step = useEffectEvent(async (name: "undo" | "redo") => {
    try {
      // null: nothing of the translator's is left to take back or do again
      if (await request(name, {})) onChanged()
    } catch (e) {
      // 409: a later change touched the same paragraph, and the server says whose — news, not a failure
      const refused = e instanceof ApiError && e.status === 409
      const say = refused ? toast.warning : toast.error
      say(name === "undo" ? "Can't undo" : "Can't redo", { description: e instanceof Error ? e.message : String(e) })
    }
  })

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.key.toLowerCase() !== "z") return
      if (event.target instanceof Element && event.target.closest("[contenteditable=true], input, textarea")) return
      event.preventDefault()
      void step(event.shiftKey ? "redo" : "undo")
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [])
}
