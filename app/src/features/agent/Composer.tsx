import { useEffect, useRef, useState } from "react"
import { IconArrowUp, IconChevronDown, IconPlayerStopFilled } from "@tabler/icons-react"

import {
  DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea } from "@/components/ui/input-group"
import { EFFORTS, MODELS, type Claude } from "@/data/useClaude"
import { Pointed } from "./Pointed"

const modelName = (id: string | null | undefined) => MODELS.find((m) => m.id === id)?.name ?? id ?? ""

/** shadcn AI Elements' Prompt Input: what the translator pointed at above the box; below it the model and effort the
 *  next message goes to (changed between turns, not while Claude answers) and Send, which is Stop while Claude answers.
 *  Enter sends, Shift+Enter breaks the line; an Enter that completes Korean input is not a send. */
export function Composer({ claude, focusToken }: { claude: Claude; focusToken: number }) {
  const [text, setText] = useState("")
  const box = useRef<HTMLTextAreaElement>(null)
  useEffect(() => { if (focusToken) box.current?.focus() }, [focusToken])
  const working = claude.view.state.status !== "idle" || claude.pending !== null
  const canSend = !working && text.trim().length > 0
  const send = () => {
    if (!canSend) return
    claude.send(text.trim())
    setText("")
  }
  return (
    <form className="shrink-0 p-2" onSubmit={(e) => { e.preventDefault(); send() }}>
      <InputGroup>
        {claude.pointed && (
          <InputGroupAddon align="block-start">
            <Pointed pointed={claude.pointed} onRemove={() => claude.point(null)} />
          </InputGroupAddon>
        )}
        <InputGroupTextarea
          ref={box}
          aria-label="Message to Claude"
          placeholder="Ask Claude about this chapter…"
          className="min-h-14 text-[13px]"
          lang="ko"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return
            e.preventDefault()
            send()
          }}
        />
        <InputGroupAddon align="block-end" className="pt-1">
          <DropdownMenu>
            <DropdownMenuTrigger disabled={working} title={working ? "Change it once Claude has answered" : "For the next message"}
              render={<InputGroupButton size="sm" variant="ghost" className="text-muted-foreground" />}>
              {modelName(claude.config.model)} · {claude.config.effort}<IconChevronDown data-icon="inline-end" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" side="top" className="w-44">
              <DropdownMenuGroup>
                <DropdownMenuLabel>Model</DropdownMenuLabel>
                <DropdownMenuRadioGroup value={claude.config.model} onValueChange={(v) => claude.configure({ model: String(v) })}>
                  {MODELS.map((m) => <DropdownMenuRadioItem key={m.id} value={m.id}>{m.name}</DropdownMenuRadioItem>)}
                </DropdownMenuRadioGroup>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuLabel>Effort</DropdownMenuLabel>
                <DropdownMenuRadioGroup value={claude.config.effort} onValueChange={(v) => claude.configure({ effort: String(v) })}>
                  {EFFORTS.map((e) => <DropdownMenuRadioItem key={e} value={e}>{e}</DropdownMenuRadioItem>)}
                </DropdownMenuRadioGroup>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          {working ? (
            <InputGroupButton type="button" size="icon-sm" variant="default" className="ml-auto" aria-label="Stop" onClick={claude.stop}>
              <IconPlayerStopFilled />
            </InputGroupButton>
          ) : (
            <InputGroupButton type="submit" size="icon-sm" variant="default" className="ml-auto" aria-label="Send" disabled={!canSend}>
              <IconArrowUp />
            </InputGroupButton>
          )}
        </InputGroupAddon>
      </InputGroup>
    </form>
  )
}
