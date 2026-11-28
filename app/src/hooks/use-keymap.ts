import { useEffect, useEffectEvent } from "react"

/** A key, as written here: "ArrowDown", "j", " ", "Enter", or with ⌘ (Ctrl elsewhere) as "Mod+i". */
export type Keymap = Partial<Record<string, () => void>>

/** Keys for the screen while nothing is being typed into. In an editor, a field or a menu the keys are theirs; on a
 *  focused button or checkbox, Space and Enter press it, as they would anywhere. */
export function useKeymap(keys: Keymap) {
  const run = useEffectEvent((event: KeyboardEvent) => {
    const target = event.target instanceof Element ? event.target : null
    if (target?.closest("[contenteditable=true], input, textarea, select, [role=listbox], [role=menu], [role=combobox]")) return
    if ((event.key === " " || event.key === "Enter") && target?.closest("button, [role=checkbox], a[href]")) return
    if (event.altKey) return
    const mod = event.metaKey || event.ctrlKey
    const name = mod ? `Mod+${event.key.toLowerCase()}` : event.shiftKey && event.key.length > 1 ? `Shift+${event.key}` : event.key
    const action = keys[name]
    if (!action) return
    event.preventDefault()
    action()
  })
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => run(event)
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [])
}
