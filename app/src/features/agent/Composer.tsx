import { useEffect, useRef, useState } from "react"
import { IconArrowUp, IconChevronDown, IconPlayerStopFilled } from "@tabler/icons-react"

import {
  DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea } from "@/components/ui/input-group"
import { type Claude } from "@/data/useClaude"
import { Pointed } from "./Pointed"

/** shadcn AI Elements' Prompt Input: what the translator pointed at above the box; below it the model and effort the
 *  next message goes to (changed between turns, not while Claude answers) and Send, which is Stop while Claude answers.
 *  Enter sends, Shift+Enter breaks the line; an Enter that completes Korean input is not a send. */
export function Composer({ claude, focusToken }: { claude: Claude; focusToken: number }) {
  const [text, setText] = useState("")
  const box = useRef<HTMLTextAreaElement>(null)
  useEffect(() => { if (focusToken) box.current?.focus() }, [focusToken])
  const working = claude.view.state.status !== "idle" || claude.pending !== null
  // the models and their efforts as Claude Code offers them (docs/agent.md §31); one the list does not name keeps its id
  const model = claude.models.find((m) => m.id === claude.config.model)
  const efforts = model?.efforts.length ? model.efforts : ["low", "medium", "high"]
  // sent while Claude answers, a message joins the turn or begins the next (§33): the box stays open; only one at a
  // time waits for the server to take it
  const canSend = claude.pending === null && text.trim().length > 0
  const send = () => {
    if (!canSend) return
    claude.send(text.trim())
    setText("")
  }
  return (
    <form className="shrink-0 p-2" onSubmit={(e) => { e.preventDefault(); send() }}>
      <InputGroup>
        {claude.pointed && (
          <InputGroupAddon align="block-start" className="px-4">
            <Pointed pointed={claude.pointed} onRemove={() => claude.point(null)} />
          </InputGroupAddon>
        )}
        <InputGroupTextarea
          ref={box}
          aria-label="Message to Claude"
          placeholder="Ask Claude about this chapter…"
          // the textarea's own md:text-xs would win over a size given without md:. The words, the chip above and the
          // buttons below keep to one edge 16px in (docs/agent.md §25)
          className="min-h-14 px-4 text-sm/relaxed md:text-sm/relaxed"
          lang="ko"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return
            e.preventDefault()
            send()
          }}
        />
        <InputGroupAddon align="block-end" className="px-4 pt-1">
          <DropdownMenu>
            <DropdownMenuTrigger disabled={working} title={working ? "Change it once Claude has answered" : "For the next message"}
              // a ghost button's words keep to the edge, not its unseen box: pulled out by its border and padding
              render={<InputGroupButton size="sm" variant="ghost" className="-ml-2.25 text-muted-foreground" />}>
              {model?.name ?? claude.config.model} · {claude.config.effort}<IconChevronDown data-icon="inline-end" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" side="top" className="w-44">
              <DropdownMenuGroup>
                <DropdownMenuLabel>Model</DropdownMenuLabel>
                <DropdownMenuRadioGroup value={claude.config.model} onValueChange={(v) => claude.configure({ model: String(v) })}>
                  {claude.models.map((m) => <DropdownMenuRadioItem key={m.id} value={m.id}>{m.name}</DropdownMenuRadioItem>)}
                </DropdownMenuRadioGroup>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuLabel>Effort</DropdownMenuLabel>
                <DropdownMenuRadioGroup value={claude.config.effort} onValueChange={(v) => claude.configure({ effort: String(v) })}>
                  {efforts.map((e) => <DropdownMenuRadioItem key={e} value={e}>{e}</DropdownMenuRadioItem>)}
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
